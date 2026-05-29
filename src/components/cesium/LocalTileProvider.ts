import * as Cesium from 'cesium';
import type { GlobeStyle } from './ImageryManager';

export type TileScheme = 'xyz' | 'tms' | 'geographic';

export interface LocalTileConfig {
  id: string;
  name: string;
  description: string;
  urlTemplate: string;
  minLevel: number;
  maxLevel: number;
  rectangle: Cesium.Rectangle;
  scheme: TileScheme;
  credit?: string;
}

// 本地瓦片数据源配置
// scheme 说明：
//   xyz      — Web Mercator，y 从北到南（Google Maps 风格），默认尝试
//   tms      — Web Mercator，y 从南到北（TMS 风格），用 {reverseY}
//   geographic — WGS84 投影，瓦片按经纬度切分
export const LOCAL_TILE_CONFIGS: LocalTileConfig[] = [
  {
    id: 'local-global-7',
    name: '本地全球影像（7级）',
    description: 'S:\\Data\\瓦片数据\\全球7级_影像',
    urlTemplate: '/local-tiles/全球7级_影像/{z}/{x}/{y}.jpg',
    minLevel: 2,
    maxLevel: 7,
    rectangle: Cesium.Rectangle.fromDegrees(-180, -90, 180, 90),
    scheme: 'xyz',
    credit: '本地全球影像',
  },
  {
    id: 'local-beijing',
    name: '本地北京影像',
    description: 'S:\\Data\\瓦片数据\\北京地球站_影像',
    urlTemplate: '/local-tiles/北京地球站_影像/{z}/{x}/{y}.jpg',
    minLevel: 2,
    maxLevel: 16,
    rectangle: Cesium.Rectangle.fromDegrees(116.04, 39.82, 116.51, 40.29),
    scheme: 'xyz',
    credit: '本地北京影像',
  },
  {
    id: 'local-huailai',
    name: '本地怀来影像',
    description: 'S:\\Data\\瓦片数据\\怀来地球站影像_影像',
    urlTemplate: '/local-tiles/怀来地球站影像_影像/{z}/{x}/{y}.jpg',
    minLevel: 2,
    maxLevel: 16,
    rectangle: Cesium.Rectangle.fromDegrees(115.35, 40.15, 115.83, 40.44),
    scheme: 'xyz',
    credit: '本地怀来影像',
  },
  {
    id: 'local-xinjiang',
    name: '本地新疆影像',
    description: 'S:\\Data\\瓦片数据\\新疆区域_影像',
    urlTemplate: '/local-tiles/新疆区域_影像/{z}/{x}/{y}.jpg',
    minLevel: 2,
    maxLevel: 13,
    rectangle: Cesium.Rectangle.fromDegrees(79.5, 41.5, 82.0, 46.0),
    scheme: 'xyz',
    credit: '本地新疆影像',
  },
];

function buildUrlTemplate(config: LocalTileConfig): string {
  if (config.scheme === 'tms') {
    return config.urlTemplate.replace('{y}', '{reverseY}');
  }
  return config.urlTemplate;
}

function buildTilingScheme(config: LocalTileConfig): Cesium.TilingScheme {
  if (config.scheme === 'geographic') {
    return new Cesium.GeographicTilingScheme();
  }
  return new Cesium.WebMercatorTilingScheme();
}

export function createLocalImageryProvider(config: LocalTileConfig): Cesium.ImageryProvider {
  return new Cesium.UrlTemplateImageryProvider({
    url: buildUrlTemplate(config),
    minimumLevel: config.minLevel,
    maximumLevel: config.maxLevel,
    rectangle: config.rectangle,
    tilingScheme: buildTilingScheme(config),
    credit: config.credit,
  });
}

export function getLocalGlobeStyles(): GlobeStyle[] {
  return LOCAL_TILE_CONFIGS.map((config) => ({
    id: config.id,
    name: config.name,
    description: config.description,
    createImageryProvider: () => createLocalImageryProvider(config),
  }));
}

export function getLocalTileConfigs(): LocalTileConfig[] {
  return LOCAL_TILE_CONFIGS;
}

export function getLocalConfigById(id: string): LocalTileConfig | undefined {
  return LOCAL_TILE_CONFIGS.find((c) => c.id === id);
}
