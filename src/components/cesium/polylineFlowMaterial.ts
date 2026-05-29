import * as Cesium from 'cesium';

const POLYLINE_FLOW_TYPE = 'PolylineFlow';

let registered = false;

export interface PolylineFlowMaterialOptions {
  /** 流动箭头主色（贴图着色） */
  color: Cesium.Color;
  /** 箭头贴图 URL */
  image: string;
  /** 沿轨迹重复次数（水平） */
  repeat?: Cesium.Cartesian2;
  /** 流动速度，与 mars3d LineFlow 同量级 */
  speed?: number;
}

type MaterialCache = {
  addMaterial: (type: string, material: { fabric: object }) => void;
};

/** 注册自定义 PolylineFlow 材质（仅一次） */
export function registerPolylineFlowMaterial(): void {
  if (registered) return;
  registered = true;

  (Cesium.Material as unknown as { PolylineFlowType?: string }).PolylineFlowType = POLYLINE_FLOW_TYPE;

  const cache = (Cesium.Material as unknown as { _materialCache: MaterialCache })._materialCache;
  cache.addMaterial(POLYLINE_FLOW_TYPE, {
    fabric: {
      type: POLYLINE_FLOW_TYPE,
      uniforms: {
        color: new Cesium.Color(0, 1, 1, 1),
        image: Cesium.Material.DefaultImageId,
        speed: 30,
        repeat: new Cesium.Cartesian2(40, 1),
      },
      source: `
        czm_material czm_getMaterial(czm_materialInput materialInput)
        {
          czm_material material = czm_getDefaultMaterial(materialInput);
          vec2 st = materialInput.st;
          float time = fract(czm_frameNumber / 1000.0 * speed);
          vec2 uv = vec2(fract(st.s * repeat.x - time), clamp(st.t * repeat.y, 0.0, 1.0));
          vec4 arrow = texture(image, uv);
          float mask = arrow.a * arrow.r;
          material.diffuse = color.rgb;
          material.alpha = color.a * mask;
          return material;
        }
      `,
    },
  });
}

/**
 * 流动箭头 polyline 材质（方向沿 positions 从首点到末点，与 PolylineArrow 一致）
 */
export class PolylineFlowMaterialProperty implements Cesium.MaterialProperty {
  readonly isConstant = true;
  readonly definitionChanged = new Cesium.Event();
  readonly color: Cesium.Color;
  readonly image: string;
  readonly speed: number;
  readonly repeat: Cesium.Cartesian2;

  constructor(options: PolylineFlowMaterialOptions) {
    registerPolylineFlowMaterial();
    this.color = options.color;
    this.image = options.image;
    this.speed = options.speed ?? 30;
    this.repeat = options.repeat ?? new Cesium.Cartesian2(40, 1);
  }

  getType(_time: Cesium.JulianDate): string {
    return POLYLINE_FLOW_TYPE;
  }

  getValue(_time?: Cesium.JulianDate, result?: Record<string, unknown>): Record<string, unknown> {
    const out = result ?? {};
    out.color = this.color;
    out.image = this.image;
    out.speed = this.speed;
    out.repeat = this.repeat;
    return out;
  }

  equals(other?: Cesium.Property): boolean {
    if (this === other) return true;
    if (!(other instanceof PolylineFlowMaterialProperty)) return false;
    return (
      this.color.equals(other.color) &&
      this.image === other.image &&
      this.speed === other.speed &&
      Cesium.Cartesian2.equals(this.repeat, other.repeat)
    );
  }
}

export function createPolylineFlowMaterialProperty(
  options: PolylineFlowMaterialOptions
): PolylineFlowMaterialProperty {
  return new PolylineFlowMaterialProperty(options);
}

export function polylineFlowOptionsKey(options: PolylineFlowMaterialOptions): string {
  const rep = options.repeat ?? new Cesium.Cartesian2(40, 1);
  return [
    options.color.toCssHexString(),
    options.image,
    options.speed ?? 30,
    rep.x,
    rep.y,
  ].join('|');
}
