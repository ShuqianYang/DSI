import type { SingleTileOverlaySpec } from '@/components/cesium/CesiumMap';

/**
 * 示例：轴对齐经纬矩形 + 单张图片 URL（PNG/JPEG）。
 * 使用仓库内 public 资源；更换为你的业务 URL 即可。
 * tileWidth/tileHeight 须与实际图像像素一致，否则 Cesium 会抛 DeveloperError。
 */
export const DEMO_SINGLE_TILE_PEARL_DELTA: SingleTileOverlaySpec = {
  id: 'demo-single-tile-pearl-delta',
  url: '/textures/earth/earth-day-2k.jpg',
  rectangle: {
    west: 113.15,
    south: 22.32,
    east: 114.85,
    north: 22.92,
  },
  alpha: 0.75,
  tileWidth: 2048,
  tileHeight: 1024,
};
