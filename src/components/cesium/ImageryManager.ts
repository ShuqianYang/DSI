import * as Cesium from 'cesium';
import { getLocalGlobeStyles } from './LocalTileProvider';

export interface GlobeStyle {
  id: string;
  name: string;
  description: string;
  createImageryProvider: () => Cesium.ImageryProvider;
}

const ONLINE_GLOBE_STYLES: GlobeStyle[] = [
  {
    id: 'blue-marble',
    name: '蓝色大理石 (经典)',
    description: 'ArcGIS World Imagery 卫星影像',
    createImageryProvider: () =>
      new Cesium.UrlTemplateImageryProvider({
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        credit: 'Esri',
      }),
  },
  {
    id: 'dark',
    name: '深色模式',
    description: 'CARTO 深色主题，适合夜间使用',
    createImageryProvider: () =>
      new Cesium.UrlTemplateImageryProvider({
        url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        subdomains: ['a', 'b', 'c', 'd'],
        credit: '© OpenStreetMap contributors © CARTO',
      }),
  },
  {
    id: 'terrain',
    name: '地形图',
    description: 'ESRI 世界地形底图',
    createImageryProvider: () =>
      new Cesium.UrlTemplateImageryProvider({
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Terrain_Base/MapServer/tile/{z}/{y}/{x}',
        credit: 'Esri',
      }),
  },
  {
    id: 'ocean',
    name: '海洋图',
    description: 'ESRI 海洋基底图',
    createImageryProvider: () =>
      new Cesium.UrlTemplateImageryProvider({
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}',
        credit: 'Esri',
      }),
  },
  {
    id: 'night',
    name: '夜景模式',
    description: 'NASA 黑大理石夜景影像',
    createImageryProvider: () =>
      new Cesium.UrlTemplateImageryProvider({
        url: 'https://map1.vis.earthdata.nasa.gov/wmts-webmerc/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png',
        maximumLevel: 8,
        credit: 'NASA GIBS',
      }),
  },
];

export const GLOBE_STYLES: GlobeStyle[] = [
  ...getLocalGlobeStyles(),
  ...ONLINE_GLOBE_STYLES,
];

export function getStyleById(id: string): GlobeStyle {
  return GLOBE_STYLES.find((s) => s.id === id) || GLOBE_STYLES[0];
}
