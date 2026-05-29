import * as Cesium from 'cesium';
import type { MapDrawResult } from '@/types/mapDraw';

const STROKE = Cesium.Color.fromCssColorString('#00E0FF');
const FILL = STROKE.withAlpha(0.22);

function nextId() {
  return `map-draw-persist-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** 将一次绘制结果写入持久数据源（与交互预览层分离，退出绘制模式后仍保留） */
export function addPersistedMapDraw(ds: Cesium.CustomDataSource, result: MapDrawResult) {
  const id = nextId();
  switch (result.kind) {
    case 'point':
      ds.entities.add({
        id,
        position: Cesium.Cartesian3.fromDegrees(result.lngLat[0], result.lngLat[1], 0),
        point: {
          pixelSize: 12,
          color: STROKE,
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      break;
    case 'polyline': {
      const flat: number[] = [];
      for (const [lng, lat] of result.coordinates) {
        flat.push(lng, lat);
      }
      ds.entities.add({
        id,
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArray(flat),
          width: 4,
          material: STROKE,
          arcType: Cesium.ArcType.GEODESIC,
          clampToGround: true,
        },
      });
      break;
    }
    case 'polygon': {
      const positions = result.coordinates.map(([lng, lat]) => Cesium.Cartesian3.fromDegrees(lng, lat, 0));
      ds.entities.add({
        id,
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(positions),
          material: FILL,
          outline: true,
          outlineColor: STROKE,
          outlineWidth: 2,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
      });
      break;
    }
    case 'rectangle':
      ds.entities.add({
        id,
        rectangle: {
          coordinates: Cesium.Rectangle.fromDegrees(result.west, result.south, result.east, result.north),
          material: FILL,
          outline: true,
          outlineColor: STROKE,
          outlineWidth: 2,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
      });
      break;
  }
}
