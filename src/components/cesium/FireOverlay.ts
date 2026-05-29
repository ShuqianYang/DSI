import * as Cesium from 'cesium';

// 火灾区域范围（Kensai 地区）
const FIRE_RECTANGLE = Cesium.Rectangle.fromDegrees(76.967, 43.241, 77.029, 43.286);

// 灾后影像尺寸
const FIRE_TILE_WIDTH = 691;
const FIRE_TILE_HEIGHT = 502;

/**
 * 返回火灾区域 Rectangle
 */
export function getFireRectangle(): Cesium.Rectangle {
  return FIRE_RECTANGLE;
}

/**
 * 创建灾后影像 overlay Provider（单图覆盖）
 */
export function createFireOverlayProvider(): Cesium.ImageryProvider {
  return new Cesium.SingleTileImageryProvider({
    url: '/local-tiles/fire.png',
    rectangle: FIRE_RECTANGLE,
    tileWidth: FIRE_TILE_WIDTH,
    tileHeight: FIRE_TILE_HEIGHT,
  });
}

/**
 * 创建烧毁遮罩 overlay Provider（单图覆盖）
 */
export function createFireMaskProvider(): Cesium.ImageryProvider {
  return new Cesium.SingleTileImageryProvider({
    url: '/local-tiles/fire_mask_on_truecolor.png',
    rectangle: FIRE_RECTANGLE,
    tileWidth: FIRE_TILE_WIDTH,
    tileHeight: FIRE_TILE_HEIGHT,
  });
}
