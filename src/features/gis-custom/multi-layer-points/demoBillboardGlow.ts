import { billboardGlowSvgDataUri } from '@/components/cesium/billboardGlowSvg';

/** 默认：主题青色（与 CesiumMap 内置 fallback 同源样式） */
export const DEMO_BILLBOARD_GLOW_CYAN = billboardGlowSvgDataUri('rgb(0,224,255)');

/** 备选：琥珀色（演示换图） */
export const DEMO_BILLBOARD_GLOW_AMBER = billboardGlowSvgDataUri('rgb(255,170,0)');
