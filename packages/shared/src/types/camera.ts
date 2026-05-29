import { z } from "zod";

// 摄像头视角声明：capability 可在 gisData 上输出 cameraView 显式指定 flyTo 目标
// 前端 CesiumMap auto-flyTo 优先使用此字段，回退到 region bbox 算法
//
// - fit-bbox：相机自动适应一个经纬度矩形（适合多点散布场景，如多艘船只）
// - point：相机飞到一个点位 + 显式 altitude（适合单点特写，如首要嫌疑船）

export const CameraView = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("fit-bbox"),
    bbox: z.object({
      west: z.number(),
      south: z.number(),
      east: z.number(),
      north: z.number(),
    }),
    /** 边距倍率，默认 0.2（在 bbox 外围加 20% 余量）；前端按 bbox 跨度 ×(1+padding) 算 altitude */
    padding: z.number().optional(),
  }),
  z.object({
    type: z.literal("point"),
    lng: z.number(),
    lat: z.number(),
    /** 米 */
    altitude: z.number(),
  }),
]);
export type CameraView = z.infer<typeof CameraView>;
