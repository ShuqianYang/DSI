// GIS capability 已注释 —— maritime 自带地图实体展示能力，无需独立 GIS action
// 如需恢复，取消下方注释即可

// import { v4 as uuidv4 } from "uuid";
// import type { Action, ActionResult } from "@datasourceintelligence/shared";
// import type { Capability } from "../types.js";
//
// const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
//
// export const gisCapability: Capability = {
//   name: "gis",
//   description: "GIS 联动：在3D地球引擎上展示空间数据、轨迹、热力图等",
//
//   execute: async (action: Action, context?: Record<string, unknown>): Promise<ActionResult> => {
//     await sleep(1500);
//     const params = action.params as { query?: string; layerType?: string };
//     const query = params.query || "未指定查询";
//
//     const maritimeData = context?.maritime || null;
//     const intelligenceData = context?.intelligence || null;
//
//     const mockData = {
//       query,
//       renderId: uuidv4(),
//       timestamp: new Date().toISOString(),
//       viewConfig: {
//         center: { lat: 30.0, lng: 125.0, altitude: 500000 },
//         zoom: 8,
//         pitch: 45,
//         bearing: 0,
//       },
//       layers: [
//         {
//           id: "vessel-points",
//           type: "point",
//           name: "船舶位置",
//           visible: true,
//           data: maritimeData
//             ? (maritimeData as Record<string, unknown>).vessels
//             : [
//                 { id: "V001", lat: 30.5, lng: 125.2, status: "normal", label: "远望号" },
//                 { id: "V002", lat: 29.8, lng: 124.5, status: "warning", label: "探索号" },
//                 { id: "V003", lat: 30.1, lng: 126.0, status: "danger", label: "海神号" },
//               ],
//           style: {
//             normal: { color: "#44FF44", size: 8 },
//             warning: { color: "#FFAA00", size: 10 },
//             danger: { color: "#FF4444", size: 12 },
//           },
//         },
//         {
//           id: "trajectory-lines",
//           type: "line",
//           name: "航行轨迹",
//           visible: true,
//           data: [
//             {
//               id: "traj-1",
//               points: [
//                 { lat: 30.3, lng: 125.0 },
//                 { lat: 30.5, lng: 125.2 },
//                 { lat: 30.7, lng: 125.4 },
//               ],
//               color: "#00E0FF",
//               width: 2,
//             },
//           ],
//         },
//         {
//           id: "risk-heatmap",
//           type: "heatmap",
//           name: "风险热力图",
//           visible: true,
//           data: [
//             { lat: 30.5, lng: 125.2, intensity: 0.3 },
//             { lat: 29.8, lng: 124.5, intensity: 0.6 },
//             { lat: 30.1, lng: 126.0, intensity: 1.0 },
//           ],
//           config: {
//             radius: 25,
//             maxIntensity: 1.0,
//             colorGradient: ["#00FF00", "#FFFF00", "#FF0000"],
//           },
//         },
//       ],
//       controls: {
//         timeSlider: true,
//         layerSwitcher: true,
//         measureTool: true,
//         export: true,
//       },
//       linkedIntelligence: intelligenceData
//         ? {
//             summary: (intelligenceData as Record<string, unknown>).summary,
//             keyEntities: (intelligenceData as Record<string, unknown>).keyEntities,
//           }
//         : null,
//     };
//
//     return {
//       success: true,
//       data: mockData,
//       metadata: {
//         capability: "gis",
//         executionTime: 600,
//         mock: true,
//       },
//     };
//   },
// };
