// ShipDT 网格管理器 — 视口拆分、瓦片对齐、密度处理

import { queryAreaShip, type ShipDTTileResult, type ShipDTAreaShip } from "./shipdtClient.js";

const GRID_SIZE = 0.5; // 瓦片对齐粒度：0.5°
const MAX_TILE_LON = 2.0; // ShipDT 最大经度范围
const MAX_TILE_LAT = 2.0; // ShipDT 最大纬度范围
const MAX_TILES_PER_VIEWPORT = 10; // 单次视口最多查询 10 个瓦片

export interface TileKey {
  x: number; // floor(lng / GRID_SIZE)
  y: number; // floor(lat / GRID_SIZE)
}

export interface Tile {
  minLng: number;
  maxLng: number;
  minLat: number;
  maxLat: number;
  key: string; // "{x}:{y}"
}

export interface DenseCell {
  minLng: number;
  maxLng: number;
  minLat: number;
  maxLat: number;
  count: number;
}

export interface ViewportResult {
  ships: ShipDTAreaShip[];
  denseCells: DenseCell[];
  tilesQueried: number;
  tilesFromCache: number;
}

// ==================== 瓦片计算 ====================

function alignToGrid(value: number): number {
  return Math.floor(value / GRID_SIZE) * GRID_SIZE;
}

function ceilToGrid(value: number): number {
  return Math.ceil(value / GRID_SIZE) * GRID_SIZE;
}

/** 将 bbox 拆分为对齐到 GRID_SIZE 的瓦片 */
export function decomposeViewport(
  minLng: number,
  maxLng: number,
  minLat: number,
  maxLat: number
): Tile[] {
  const tiles: Tile[] = [];

  const startLng = alignToGrid(minLng);
  const endLng = ceilToGrid(maxLng);
  const startLat = alignToGrid(minLat);
  const endLat = ceilToGrid(maxLat);

  for (let lng = startLng; lng < endLng; lng += GRID_SIZE) {
    for (let lat = startLat; lat < endLat; lat += GRID_SIZE) {
      const tileMinLng = Math.max(lng, minLng);
      const tileMaxLng = Math.min(lng + GRID_SIZE, maxLng);
      const tileMinLat = Math.max(lat, minLat);
      const tileMaxLat = Math.min(lat + GRID_SIZE, maxLat);

      // 转换为 ShipDT 需要的 micro-degree
      tiles.push({
        minLng: tileMinLng,
        maxLng: tileMaxLng,
        minLat: tileMinLat,
        maxLat: tileMaxLat,
        key: `${Math.floor(lng / GRID_SIZE)}:${Math.floor(lat / GRID_SIZE)}`,
      });
    }
  }

  return tiles;
}

/** 合并相邻的同纬度瓦片，减少 ShipDT 请求数 */
export function mergeTiles(tiles: Tile[]): Tile[] {
  if (tiles.length <= 1) return tiles;

  const merged: Tile[] = [];
  const visited = new Set<string>();

  for (const tile of tiles) {
    if (visited.has(tile.key)) continue;

    let current = { ...tile };
    visited.add(tile.key);

    // 尝试向右合并（经度方向）
    let canMerge = true;
    while (canMerge) {
      const rightKey = `${Math.floor(current.maxLng / GRID_SIZE)}:${Math.floor(current.minLat / GRID_SIZE)}`;
      const rightTile = tiles.find((t) => t.key === rightKey && !visited.has(t.key));

      if (
        rightTile &&
        current.minLat === rightTile.minLat &&
        current.maxLat === rightTile.maxLat &&
        current.maxLng - current.minLng + (rightTile.maxLng - rightTile.minLng) <= MAX_TILE_LON
      ) {
        current.maxLng = rightTile.maxLng;
        visited.add(rightTile.key);
      } else {
        canMerge = false;
      }
    }

    merged.push(current);
  }

  return merged;
}

// ==================== 缓存集成 ====================

let cacheGet: ((key: string) => ShipDTTileResult | undefined) | null = null;
let cacheSet: ((key: string, value: ShipDTTileResult, ttlMs: number) => void) | null = null;

export function registerCache(
  get: (key: string) => ShipDTTileResult | undefined,
  set: (key: string, value: ShipDTTileResult, ttlMs: number) => void
) {
  cacheGet = get;
  cacheSet = set;
}

function getCacheKey(tile: Tile): string {
  return `shipdt:${tile.key}`;
}

// ==================== 视口查询 ====================

export async function queryViewport(
  minLng: number,
  maxLng: number,
  minLat: number,
  maxLat: number
): Promise<ViewportResult> {
  console.log(`[ShipDT] queryViewport: bbox=[${minLng},${maxLng},${minLat},${maxLat}]`);
  const tiles = decomposeViewport(minLng, maxLng, minLat, maxLat);
  const mergedTiles = mergeTiles(tiles);
  console.log(`[ShipDT] Tiles: ${tiles.length} raw, ${mergedTiles.length} merged`);

  // 如果瓦片太多，只取中心区域的（优先加载用户视野中心）
  const centerLng = (minLng + maxLng) / 2;
  const centerLat = (minLat + maxLat) / 2;
  const sortedTiles = mergedTiles.sort((a, b) => {
    const distA =
      Math.pow((a.minLng + a.maxLng) / 2 - centerLng, 2) +
      Math.pow((a.minLat + a.maxLat) / 2 - centerLat, 2);
    const distB =
      Math.pow((b.minLng + b.maxLng) / 2 - centerLng, 2) +
      Math.pow((b.minLat + b.maxLat) / 2 - centerLat, 2);
    return distA - distB;
  });

  const tilesToQuery = sortedTiles.slice(0, MAX_TILES_PER_VIEWPORT);

  const allShips: ShipDTAreaShip[] = [];
  const denseCells: DenseCell[] = [];
  let tilesQueried = 0;
  let tilesFromCache = 0;

  for (const tile of tilesToQuery) {
    const cacheKey = getCacheKey(tile);
    console.log(`[ShipDT] Processing tile ${tile.key}, cacheKey=${cacheKey}`);

    // 尝试缓存
    if (cacheGet) {
      const cached = cacheGet(cacheKey);
      if (cached) {
        tilesFromCache++;
        if (cached.ships) {
          allShips.push(...cached.ships);
        }
        if (cached.isDense) {
          denseCells.push({
            minLng: tile.minLng,
            maxLng: tile.maxLng,
            minLat: tile.minLat,
            maxLat: tile.maxLat,
            count: cached.count,
          });
        }
        continue;
      }
    }

    // GetAreaShip 接口当前未启用，跳过 ShipDT API 调用
    // tilesQueried++;
    // console.log(`[ShipDT] Querying API for tile ${tile.key}: [${tile.minLng},${tile.maxLng},${tile.minLat},${tile.maxLat}]`);
    // try {
    //   const result = await queryAreaShip({
    //     minlon: Math.round(tile.minLng * 1_000_000),
    //     maxlon: Math.round(tile.maxLng * 1_000_000),
    //     minlat: Math.round(tile.minLat * 1_000_000),
    //     maxlat: Math.round(tile.maxLat * 1_000_000),
    //   });
    //   console.log(`[ShipDT] Tile ${tile.key} result: ships=${result.ships?.length ?? 0}, isDense=${result.isDense}, count=${result.count}`);
    //
    //   // 写入缓存
    //   if (cacheSet) {
    //     cacheSet(cacheKey, result, 120_000);
    //   }
    //
    //   if (result.ships) {
    //     allShips.push(...result.ships);
    //   }
    //   if (result.isDense) {
    //     denseCells.push({
    //       minLng: tile.minLng,
    //       maxLng: tile.maxLng,
    //       minLat: tile.minLat,
    //       maxLat: tile.maxLat,
    //       count: result.count,
    //     });
    //   }
    // } catch (err) {
    //   console.error(`[ShipDT] Tile query failed (${tile.key}):`, err);
    //   // 查询失败时不标记为 dense，避免前端显示"约 0 艘船舶"
    //   // 该区域会在前端保持空白，下次视口移动时重新尝试查询
    // }
  }

  console.log(`[ShipDT] queryViewport done: ships=${allShips.length}, denseCells=${denseCells.length}`);
  return {
    ships: allShips,
    denseCells,
    tilesQueried,
    tilesFromCache,
  };
}
