import { v4 as uuidv4 } from "uuid";
import type { Action, ActionResult } from "@datasourceintelligence/shared";
import type { Capability } from "../types.js";
import {
  registerSliceCallback,
  cleanupSliceCallback,
  type SliceCallbackPayload,
} from "./satelliteCallbackStore.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 查询真实震前历史影像数据（天基信息服务系统）
// 成功返回 previewUrl，失败/无数据返回 null（由调用方回退到 mock 图）
async function fetchPreEarthquakeImageUrl(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    console.log("[fetchPreEarthquakeImageUrl] 开始调用 queryData 接口...");
    const resp = await fetch("http://192.168.0.129:5000/agent/queryData", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        pageNo: 1,
        pageSize: 10,
        satelliteName: "高分五号A星",
        payloadType: ["可见光"],
        productType: "目标切片",
        dataType: "地震前",
        targetType: "地震前",
        reqObj: "天元认知计算",
        reqContent: "接收到天元认知计算系统的历史影像查询(地震)需求，完成影像检索并反馈",
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    console.log(`[fetchPreEarthquakeImageUrl] HTTP 状态: ${resp.status} ${resp.statusText}`);
    if (!resp.ok) {
      console.log("[fetchPreEarthquakeImageUrl] 请求失败，回退到 mock 图");
      return null;
    }

    const json = (await resp.json()) as {
      state?: boolean;
      value?: { records?: Array<{ previewUrl?: string }> };
    };
    console.log(`[fetchPreEarthquakeImageUrl] 响应 state: ${json.state}, records 数量: ${json.value?.records?.length ?? 0}`);

    if (json.state && json.value?.records && json.value.records.length > 0) {
      const url = json.value.records[0].previewUrl;
      console.log(`[fetchPreEarthquakeImageUrl] 获取到真实图片 URL: ${url}`);
      return url || null;
    }
    console.log("[fetchPreEarthquakeImageUrl] 无数据返回，回退到 mock 图");
    return null;
  } catch (err) {
    console.error("[fetchPreEarthquakeImageUrl] 异常:", err instanceof Error ? err.message : err);
    return null;
  }
}

// 查询真实洪水前历史影像数据（天基信息服务系统）
// 成功返回 previewUrl，失败/无数据返回 null（由调用方回退到 mock 图）
async function fetchPreFloodImageUrl(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    console.log("[fetchPreFloodImageUrl] 开始调用 queryData 接口...");
    const resp = await fetch("http://192.168.0.129:5000/agent/queryData", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        pageNo: 1,
        pageSize: 10,
        satelliteName: "高分五号A星",
        payloadType: ["可见光"],
        productType: "目标切片",
        dataType: "洪水前",
        targetType: "洪水前",
        reqObj: "天元认知计算",
        reqContent: "接收到天元认知计算系统的历史影像查询(洪水)需求，完成影像检索并反馈",
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    console.log(`[fetchPreFloodImageUrl] HTTP 状态: ${resp.status} ${resp.statusText}`);
    if (!resp.ok) {
      console.log("[fetchPreFloodImageUrl] 请求失败，回退到 mock 图");
      return null;
    }

    const json = (await resp.json()) as {
      state?: boolean;
      value?: { records?: Array<{ previewUrl?: string }> };
    };
    console.log(`[fetchPreFloodImageUrl] 响应 state: ${json.state}, records 数量: ${json.value?.records?.length ?? 0}`);

    if (json.state && json.value?.records && json.value.records.length > 0) {
      const url = json.value.records[0].previewUrl;
      console.log(`[fetchPreFloodImageUrl] 获取到真实图片 URL: ${url}`);
      return url || null;
    }
    console.log("[fetchPreFloodImageUrl] 无数据返回，回退到 mock 图");
    return null;
  } catch (err) {
    console.error("[fetchPreFloodImageUrl] 异常:", err instanceof Error ? err.message : err);
    return null;
  }
}

// 查询真实油膜影像数据（天基信息服务系统）
// 成功返回 previewUrl，失败/无数据返回 null（由调用方回退到 mock 图）
async function fetchOilSpillImageUrl(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    console.log("[fetchOilSpillImageUrl] 开始调用 queryData 接口...");
    const resp = await fetch("http://192.168.0.129:5000/agent/queryData", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        pageNo: 1,
        pageSize: 10,
        satelliteName: "高分五号A星",
        payloadType: ["红外"],
        productType: "目标切片",
        dataType: "漏油",
        targetType: "漏油",
        reqObj: "天元认知计算",
        reqContent: "接收到天元认知计算系统的历史影像查询(油膜)需求，完成影像检索并反馈",
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    console.log(`[fetchOilSpillImageUrl] HTTP 状态: ${resp.status} ${resp.statusText}`);
    if (!resp.ok) {
      console.log("[fetchOilSpillImageUrl] 请求失败，回退到 mock 图");
      return null;
    }

    const json = (await resp.json()) as {
      state?: boolean;
      value?: { records?: Array<{ previewUrl?: string }> };
    };
    console.log(`[fetchOilSpillImageUrl] 响应 state: ${json.state}, records 数量: ${json.value?.records?.length ?? 0}`);

    if (json.state && json.value?.records && json.value.records.length > 0) {
      const url = json.value.records[0].previewUrl;
      console.log(`[fetchOilSpillImageUrl] 获取到真实图片 URL: ${url}`);
      return url || null;
    }
    console.log("[fetchOilSpillImageUrl] 无数据返回，回退到 mock 图");
    return null;
  } catch (err) {
    console.error("[fetchOilSpillImageUrl] 异常:", err instanceof Error ? err.message : err);
    return null;
  }
}

// 天基查询能力
// 真实接口：POST http://192.168.0.204:18000/satellite/query
// 未来替换为真实 Agent API 调用

export const satelliteCapability: Capability = {
  name: "satellite",
  description: "天基查询：查询卫星遥感数据、目标切片、影像产品，支持历史数据检索和新需求提报",

  execute: async (action: Action, _context?: Record<string, unknown>): Promise<ActionResult> => {
    await sleep(2500);
    const params = action.params as {
      query?: string;
      fireScenario?: boolean;
      region?: string;
      bbox?: [number, number, number, number];
    };
    const query = params.query || "未指定查询";

    // 根据查询内容模拟不同的返回类型
    const q = query.toLowerCase();

    // 情况-1：火情研判 scenario
    // demo 阶段：overlay PNG（fire.png）固定对应 Kensai 坐标（76.967-77.029°E, 43.241-43.286°N），
    // 因此影像覆盖范围和 cameraView 始终保持 Kensai，只把文字标签换成传入的 regionName。
    if (params.fireScenario === true) {
      const regionName = params.region || "未知区域";
      const KENSAI_RECT = {
        west: 76.967,
        south: 43.241,
        east: 77.029,
        north: 43.286,
      };
      const centerLng = 76.998;
      const centerLat = 43.2635;
      const CALLBACK_TIMEOUT_MS = 1_000; // 10分钟

      // 1. 生成 requirementId 并构造回调地址
      const requirementId = `REQ${Date.now()}`;
      const callbackHost = process.env.CALLBACK_HOST || "";
      const callbackPort = process.env.API_PORT || "3001";
      const callBackUrl = callbackHost
        ? `http://${callbackHost}:${callbackPort}/agent/callback/slice`
        : `http://localhost:${callbackPort}/agent/callback/slice`;

      // 2. 提报需求到外部系统
      const demandUrl = "http://192.168.0.129:5000/agent/zh/demand";
      const demandPayload = {
        requirementId,
        requirementName: `${regionName} 火情监测需求`,
        requirementSource: "天基信息服务系统",
        startTime: Date.now(),
        endTime: Date.now() + 24 * 60 * 60 * 1000,
        areaBounds:     {
      "type": "Point",
      "coordinates": [76.998, 43.2635]
    },
        targetType: "火情",
        targetName: regionName,
        algorithm: "火情识别",
        payloadMode: "可见光",
        productType: "目标切片",
        priority: "high",
        resolution: "10",
        trackType: "低",
        timeConstraints: JSON.stringify({
          latestStartTime: Date.now(),
        }),
        duration: null,
        timeLimitRequirement: "24小时内",
        rawPayload: {
          mode: 2,
        },
        submitTime: Date.now(),
        callBackUrl,
      };

      console.log(`[Satellite] 提报火情需求: ${demandUrl}`);
      console.log(`[Satellite] requirementId=${requirementId}, callBackUrl=${callBackUrl}`);
      console.log("[Satellite] 火情需求传参:", JSON.stringify(demandPayload, null, 2));

      // 2. 提报需求，解析对方返回的 value 作为实际 requirementId
      let actualRequirementId = requirementId;
      let demandOk = false;
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 8000);
        const demandResp = await fetch(demandUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(demandPayload),
          signal: ctrl.signal,
        });
        clearTimeout(t);
        const demandBody = await demandResp.text();
        console.log(`[Satellite] Demand status: ${demandResp.status}, body: ${demandBody}`);
        demandOk = demandResp.ok;

        if (demandOk) {
          try {
            const demandJson = JSON.parse(demandBody) as { value?: string };
            if (demandJson.value) {
              actualRequirementId = String(demandJson.value);
              console.log(`[Satellite] 对方返回 value=${actualRequirementId}，用此值注册回调等待`);
            }
          } catch {
            // 解析失败仍用原始的 requirementId
          }
        }
      } catch (err) {
        console.error("[Satellite] 需求提报失败:", err instanceof Error ? err.message : err);
      }

      // 3. 阻塞等待回调（用对方返回的 actualRequirementId 注册）
      let callbackData: SliceCallbackPayload | null = null;
      if (demandOk) {
        console.log(`[Satellite] 等待回调 ${CALLBACK_TIMEOUT_MS / 1000}s... (requirementId=${actualRequirementId})`);
        const callbackPromise = registerSliceCallback(actualRequirementId);
        const timeoutPromise = sleep(CALLBACK_TIMEOUT_MS).then(() => null);
        try {
          callbackData = await Promise.race([callbackPromise, timeoutPromise]);
          if (callbackData) {
            console.log(`[Satellite] 收到回调: ${callbackData.url}`);
          } else {
            console.log("[Satellite] 等待回调超时，回退到本地影像");
          }
        } catch (err) {
          console.error("[Satellite] 等待回调异常:", err instanceof Error ? err.message : err);
        } finally {
          cleanupSliceCallback(actualRequirementId);
        }
      }

      // 4. 构建返回（真实 / mock 统一结构）
      const imageUrl = callbackData?.url || "/local-tiles/fire.png";
      const isMock = !callbackData;

      return {
        success: true,
        data: {
          message: isMock
            ? `已为您调度天基资源完成 **${regionName}** 区域火情成像。\n\n| 指标 | 数值 |\n|------|------|\n| 影像数量 | 1 张 |\n| 分辨率 | 1m |\n| 云覆盖率 | <5% |\n| 卫星类型 | 高分五号A星 |\n| 覆盖范围 | 东经${KENSAI_RECT.west}°–${KENSAI_RECT.east}° / 北纬${KENSAI_RECT.south}°–${KENSAI_RECT.north}° |\n\n*未在 ${CALLBACK_TIMEOUT_MS / 1000}s 内收到外部回调，使用本地模拟影像。*`
            : `已收到 **${regionName}** 区域真实火情影像切片。\n\n| 指标 | 数值 |\n|------|------|\n| 影像来源 | ${callbackData.satellite} |\n| 分辨率 | ${callbackData.resolution}m |\n| 置信度 | ${callbackData.confidence} |\n| 回调ID | ${callbackData.id} |`,
          data: {
            type: "fire_imaging",
            responseType: "fire_imaging",
            imageCount: 1,
            resolution: isMock ? "1m" : `${callbackData.resolution}m`,
            satelliteType: isMock ? "高分五号A星" : callbackData.satellite,
            gisData: {
              type: "region",
              regions: [
                {
                  id: "fire-imagery-bounds",
                  name: `${regionName} 火情影像覆盖范围`,
                  type: "monitor",
                  coordinates: [
                    [KENSAI_RECT.west, KENSAI_RECT.south],
                    [KENSAI_RECT.east, KENSAI_RECT.south],
                    [KENSAI_RECT.east, KENSAI_RECT.north],
                    [KENSAI_RECT.west, KENSAI_RECT.north],
                    [KENSAI_RECT.west, KENSAI_RECT.south],
                  ] as [number, number][],
                  style: {
                    fill: true,
                    fillColor: "rgba(255, 42, 42, 0.08)",
                    outlineColor: "#ff2a2a",
                    outlineWidth: 2,
                    effect: "lightWall",
                  },
                  label: {
                    text: `火情影像范围`,
                    position: [centerLng, centerLat] as [number, number],
                  },
                },
              ],
              imageOverlays: [
                {
                  id: "fire-imagery-1",
                  url: imageUrl,
                  rectangle: KENSAI_RECT,
                  alpha: 0.9,
                  tileWidth: 691,
                  tileHeight: 502,
                },
              ],
              cameraView: {
                type: "point" as const,
                lng: centerLng,
                lat: centerLat,
                altitude: 30000,
              },
            },
          },
        },
        metadata: {
          capability: "satellite",
          executionTime: CALLBACK_TIMEOUT_MS,
          mock: isMock,
          responseType: "fire_imaging",
          requirementId,
          callBackUrl,
        },
      };
    }

    // ========== 地震灾后评估场景 ==========
    if (params.earthquakeScenario === true) {
      const phase = params.phase as "pre" | "post" | undefined;
      const regionName = params.region || "未知区域";
      const LIUZHOU_RECT = {
        west: 109.25894741025947,
        south: 24.36555725731195,
        east: 109.26069621053718,
        north: 24.366585886456956,
      };
      const centerLng = 109.25982181039833;
      const centerLat = 24.366071571884453;

      // ---- phase=pre：震前历史影像查询 ----
      if (phase === "pre") {
        const realImageUrl = await fetchPreEarthquakeImageUrl();
        const imageUrl = realImageUrl || "/local-tiles/pre_earthquake.png";
        const isMock = !realImageUrl;

        await sleep(1500);
        return {
          success: true,
          data: {
            message: isMock
              ? `已获取 **${regionName}** 震前最新历史影像。\n\n| 指标 | 数值 |\n|------|------|\n| 影像数量 | 1 张 |\n| 分辨率 | 1m |\n| 云覆盖率 | <5% |\n| 卫星类型 | 高分六号 |\n| 采集时间 | 2026-05-17 |\n| 覆盖范围 | 东经${LIUZHOU_RECT.west}°–${LIUZHOU_RECT.east}° / 北纬${LIUZHOU_RECT.south}°–${LIUZHOU_RECT.north}° |\n\n*使用本地模拟影像。*`
              : `已获取 **${regionName}** 震前真实历史影像。\n\n| 指标 | 数值 |\n|------|------|\n| 影像来源 | 天基信息服务系统 |\n| 分辨率 | 1m |\n| 卫星类型 | 高分六号 |`,
            data: {
              type: "pre_earthquake",
              responseType: "pre_earthquake",
              imageCount: 1,
              resolution: "1m",
              satelliteType: "高分六号",
              gisData: {
                type: "region",
                regions: [
                  {
                    id: "pre-eq-imagery-bounds",
                    name: `${regionName} 震前影像覆盖范围`,
                    type: "monitor",
                    coordinates: [
                      [LIUZHOU_RECT.west, LIUZHOU_RECT.south],
                      [LIUZHOU_RECT.east, LIUZHOU_RECT.south],
                      [LIUZHOU_RECT.east, LIUZHOU_RECT.north],
                      [LIUZHOU_RECT.west, LIUZHOU_RECT.north],
                      [LIUZHOU_RECT.west, LIUZHOU_RECT.south],
                    ] as [number, number][],
                    style: {
                      fill: false,
                      outlineColor: "#3B82F6",
                      outlineWidth: 2,
                    },
                    label: {
                      text: "震前影像范围",
                      position: [centerLng, centerLat] as [number, number],
                    },
                  },
                ],
                imageOverlays: [
                  {
                    id: "pre-earthquake-imagery",
                    url: imageUrl,
                    rectangle: LIUZHOU_RECT,
                    alpha: 0.9,
                    tileWidth: 691,
                    tileHeight: 502,
                  },
                ],
                cameraView: {
                  type: "point" as const,
                  lng: centerLng,
                  lat: centerLat,
                  altitude: 378,
                },
              },
            },
          },
          metadata: {
            capability: "satellite",
            executionTime: 1500,
            mock: isMock,
            responseType: "pre_earthquake",
          },
        };
      }

      // ---- phase=post：震后应急需求提报 + 阻塞等回调 ----
      if (phase === "post") {
        const CALLBACK_TIMEOUT_MS = 1800_000; // 10分钟
        const requirementId = `REQ-EQ${Date.now()}`;
        const callbackHost = process.env.CALLBACK_HOST || "";
        const callbackPort = process.env.API_PORT || "3001";
        const callBackUrl = callbackHost
          ? `http://${callbackHost}:${callbackPort}/agent/callback/slice`
          : `http://localhost:${callbackPort}/agent/callback/slice`;

        const demandPayload = {
          requirementId,
          requirementName: `${regionName} 5.2级地震震后应急成像需求`,
          requirementSource: "天基信息服务系统",
          startTime: Date.now(),
          endTime: Date.now() + 24 * 60 * 60 * 1000,
          areaBounds: {
            type: "Point",
            coordinates: [centerLng, centerLat],
          },
          targetType: "地震后",
          targetName: "地震后",
          algorithm: "灾后评估",
          payloadMode: "可见光",
          productType: "目标切片",
          priority: "high",
          resolution: "1",
          trackType: "低",
          timeConstraints: JSON.stringify({
            latestStartTime: Date.now(),
          }),
          duration: null,
          timeLimitRequirement: "24小时内",
          rawPayload: { mode: 2 },
          submitTime: Date.now(),
          callBackUrl,
        };

        console.log(`[Satellite] 提报地震应急需求: requirementId=${requirementId}`);
        console.log("[Satellite] 地震需求传参:", JSON.stringify(demandPayload, null, 2));

        // 提报需求（8秒超时，避免网络不通时无限挂起）
        let actualRequirementId = requirementId;
        let demandOk = false;
        let demandFailReason: string | undefined;
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 8000);
          const demandResp = await fetch("http://192.168.0.129:5000/agent/zh/demand", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify(demandPayload),
            signal: ctrl.signal,
          });
          clearTimeout(t);
          const demandBody = await demandResp.text();
          console.log(`[Satellite] Earthquake demand status: ${demandResp.status}, body: ${demandBody}`);
          demandOk = demandResp.ok;

          if (demandOk) {
            try {
              const demandJson = JSON.parse(demandBody) as { value?: string };
              if (demandJson.value) {
                actualRequirementId = String(demandJson.value);
                console.log(`[Satellite] 对方返回 value=${actualRequirementId}`);
              }
            } catch {
              // 解析失败仍用原始 requirementId
            }
          } else {
            demandFailReason = `HTTP ${demandResp.status}`;
          }
        } catch (err) {
          demandFailReason = err instanceof Error ? err.message : String(err);
          console.error("[Satellite] 地震应急需求提报失败:", demandFailReason);
        }

        // 阻塞等待回调
        let callbackData: SliceCallbackPayload | null = null;
        let timeoutReason: string | undefined;
        if (demandOk) {
          console.log(`[Satellite] 等待地震影像回调 ${CALLBACK_TIMEOUT_MS / 1000}s...`);
          const callbackPromise = registerSliceCallback(actualRequirementId);
          const timeoutPromise = sleep(CALLBACK_TIMEOUT_MS).then(() => null);
          try {
            callbackData = await Promise.race([callbackPromise, timeoutPromise]);
            if (callbackData) {
              console.log(`[Satellite] 收到地震影像回调: ${callbackData.url}`);
            } else {
              timeoutReason = `未在 ${CALLBACK_TIMEOUT_MS / 1000}s 内收到外部回调`;
              console.log("[Satellite] 地震影像回调超时，回退到本地影像");
            }
          } catch (err) {
            timeoutReason = err instanceof Error ? err.message : String(err);
            console.error("[Satellite] 等待地震影像回调异常:", timeoutReason);
          } finally {
            cleanupSliceCallback(actualRequirementId);
          }
        }

        const imageUrl = callbackData?.url || "/local-tiles/wenchuan_post.png";
        const isMock = !callbackData;
        const fallbackReason = demandFailReason || timeoutReason || "使用本地模拟影像";

        return {
          success: true,
          data: {
            message: isMock
              ? `已为您调度天基资源完成 **${regionName}** 震后应急成像。\n\n| 指标 | 数值 |\n|------|------|\n| 影像数量 | 1 张 |\n| 分辨率 | 1m |\n| 云覆盖率 | <5% |\n| 卫星类型 | 高分六号 |\n| 覆盖范围 | 东经${LIUZHOU_RECT.west}°–${LIUZHOU_RECT.east}° / 北纬${LIUZHOU_RECT.south}°–${LIUZHOU_RECT.north}° |\n\n*${fallbackReason}，回退到本地模拟影像。*`
              : `已收到 **${regionName}** 震后真实应急影像切片。\n\n| 指标 | 数值 |\n|------|------|\n| 影像来源 | ${callbackData.satellite} |\n| 分辨率 | ${callbackData.resolution}m |\n| 置信度 | ${callbackData.confidence} |\n| 回调ID | ${callbackData.id} |`,
            data: {
              type: "post_earthquake",
              responseType: "post_earthquake",
              imageCount: 1,
              resolution: isMock ? "1m" : `${callbackData.resolution}m`,
              satelliteType: isMock ? "高分六号" : callbackData.satellite,
              gisData: {
                type: "region",
                regions: [
                  {
                    id: "post-eq-imagery-bounds",
                    name: `${regionName} 震后影像覆盖范围`,
                    type: "monitor",
                    coordinates: [
                      [LIUZHOU_RECT.west, LIUZHOU_RECT.south],
                      [LIUZHOU_RECT.east, LIUZHOU_RECT.south],
                      [LIUZHOU_RECT.east, LIUZHOU_RECT.north],
                      [LIUZHOU_RECT.west, LIUZHOU_RECT.north],
                      [LIUZHOU_RECT.west, LIUZHOU_RECT.south],
                    ] as [number, number][],
                    style: {
                      fill: false,
                      outlineColor: "#EF4444",
                      outlineWidth: 2,
                    },
                    label: {
                      text: "震后影像范围",
                      position: [centerLng, centerLat] as [number, number],
                    },
                  },
                ],
                imageOverlays: [
                  {
                    id: "post-earthquake-imagery",
                    url: imageUrl,
                    rectangle: LIUZHOU_RECT,
                    alpha: 0.9,
                    tileWidth: 691,
                    tileHeight: 502,
                  },
                ],
                cameraView: {
                  type: "point" as const,
                  lng: centerLng,
                  lat: centerLat,
                  altitude: 378,
                },
              },
            },
          },
          metadata: {
            capability: "satellite",
            executionTime: CALLBACK_TIMEOUT_MS,
            mock: isMock,
            responseType: "post_earthquake",
            requirementId,
            callBackUrl,
          },
        };
      }

      // phase 未指定，默认返回 pre
      return {
        success: true,
        data: {
          message: `地震场景参数缺失，默认返回 ${regionName} 震前影像。`,
          data: {
            type: "pre_earthquake",
            responseType: "pre_earthquake",
            gisData: {
              type: "region",
              imageOverlays: [
                {
                  id: "pre-earthquake-imagery",
                  url: "/local-tiles/pre_earthquake.png",
                  rectangle: LIUZHOU_RECT,
                  alpha: 0.9,
                  tileWidth: 691,
                  tileHeight: 502,
                },
              ],
              cameraView: {
                type: "point" as const,
                lng: centerLng,
                lat: centerLat,
                altitude: 378,
              },
            },
          },
        },
        metadata: {
          capability: "satellite",
          executionTime: 500,
          mock: true,
          responseType: "pre_earthquake",
        },
      };
    }

    // ========== 暴雨洪涝灾后评估场景 ==========
    if (params.floodScenario === true) {
      const phase = params.phase as "pre" | "post" | undefined;
      const regionName = params.region || "未知区域";
      const SHIMEN_RECT = {
        west: 110.89344101467812,
        south: 29.880513149375275,
        east: 110.89603739300453,
        north: 29.88216900048024,
      };
      const centerLng = 110.894662;
      const centerLat = 29.881476;

      // ---- phase=pre：洪水前历史影像查询 ----
      if (phase === "pre") {
        const realImageUrl = await fetchPreFloodImageUrl();
        const imageUrl = realImageUrl || "/local-tiles/pre_flood.png";
        const isMock = !realImageUrl;

        await sleep(1500);
        return {
          success: true,
          data: {
            message: isMock
              ? `已获取 **${regionName}** 洪水前最新历史影像。\n\n| 指标 | 数值 |\n|------|------|\n| 影像数量 | 1 张 |\n| 分辨率 | 1m |\n| 云覆盖率 | <5% |\n| 卫星类型 | 高分六号 |\n| 采集时间 | 2026-05-16 |\n| 覆盖范围 | 东经${SHIMEN_RECT.west}°–${SHIMEN_RECT.east}° / 北纬${SHIMEN_RECT.south}°–${SHIMEN_RECT.north}° |\n\n*使用本地模拟影像。*`
              : `已获取 **${regionName}** 洪水前真实历史影像。\n\n| 指标 | 数值 |\n|------|------|\n| 影像来源 | 天基信息服务系统 |\n| 分辨率 | 1m |\n| 卫星类型 | 高分六号 |`,
            data: {
              type: "pre_flood",
              responseType: "pre_flood",
              imageCount: 1,
              resolution: "1m",
              satelliteType: "高分六号",
              gisData: {
                type: "region",
                regions: [
                  {
                    id: "pre-flood-imagery-bounds",
                    name: `${regionName} 洪水前影像覆盖范围`,
                    type: "monitor",
                    coordinates: [
                      [SHIMEN_RECT.west, SHIMEN_RECT.south],
                      [SHIMEN_RECT.east, SHIMEN_RECT.south],
                      [SHIMEN_RECT.east, SHIMEN_RECT.north],
                      [SHIMEN_RECT.west, SHIMEN_RECT.north],
                      [SHIMEN_RECT.west, SHIMEN_RECT.south],
                    ] as [number, number][],
                    style: {
                      fill: false,
                      outlineColor: "#3B82F6",
                      outlineWidth: 2,
                    },
                    label: {
                      text: "洪水前影像范围",
                      position: [centerLng, centerLat] as [number, number],
                    },
                  },
                ],
                imageOverlays: [
                  {
                    id: "pre-flood-imagery",
                    url: imageUrl,
                    rectangle: SHIMEN_RECT,
                    alpha: 0.9,
                    tileWidth: 691,
                    tileHeight: 502,
                  },
                ],
                cameraView: {
                  type: "point" as const,
                  lng: centerLng,
                  lat: centerLat,
                  altitude: 666,
                },
              },
            },
          },
          metadata: {
            capability: "satellite",
            executionTime: 1500,
            mock: isMock,
            responseType: "pre_flood",
          },
        };
      }

      // ---- phase=post：暴雨后应急需求提报 + 阻塞等回调 ----
      if (phase === "post") {
        const CALLBACK_TIMEOUT_MS = 1800_000; // 10分钟
        const requirementId = `REQ-FL${Date.now()}`;
        const callbackHost = process.env.CALLBACK_HOST || "";
        const callbackPort = process.env.API_PORT || "3001";
        const callBackUrl = callbackHost
          ? `http://${callbackHost}:${callbackPort}/agent/callback/slice`
          : `http://localhost:${callbackPort}/agent/callback/slice`;

        const demandPayload = {
          requirementId,
          requirementName: `${regionName} 暴雨洪涝灾后应急成像需求`,
          requirementSource: "天基信息服务系统",
          startTime: Date.now(),
          endTime: Date.now() + 24 * 60 * 60 * 1000,
          areaBounds: {
            type: "Point",
            coordinates: [centerLng, centerLat],
          },
          targetType: "洪水后",
          targetName: "洪水后",
          algorithm: "洪涝评估",
          payloadMode: "可见光",
          productType: "目标切片",
          priority: "high",
          resolution: "1",
          trackType: "低",
          timeConstraints: JSON.stringify({
            latestStartTime: Date.now(),
          }),
          duration: null,
          timeLimitRequirement: "24小时内",
          rawPayload: { mode: 2 },
          submitTime: Date.now(),
          callBackUrl,
        };

        console.log(`[Satellite] 提报洪水应急需求: requirementId=${requirementId}`);
        console.log("[Satellite] 洪水需求传参:", JSON.stringify(demandPayload, null, 2));

        // 提报需求（8秒超时）
        let actualRequirementId = requirementId;
        let demandOk = false;
        let demandFailReason: string | undefined;
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 8000);
          const demandResp = await fetch("http://192.168.0.129:5000/agent/zh/demand", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify(demandPayload),
            signal: ctrl.signal,
          });
          clearTimeout(t);
          const demandBody = await demandResp.text();
          console.log(`[Satellite] Flood demand status: ${demandResp.status}, body: ${demandBody}`);
          demandOk = demandResp.ok;

          if (demandOk) {
            try {
              const demandJson = JSON.parse(demandBody) as { value?: string };
              if (demandJson.value) {
                actualRequirementId = String(demandJson.value);
                console.log(`[Satellite] 对方返回 value=${actualRequirementId}`);
              }
            } catch {
              // 解析失败仍用原始 requirementId
            }
          } else {
            demandFailReason = `HTTP ${demandResp.status}`;
          }
        } catch (err) {
          demandFailReason = err instanceof Error ? err.message : String(err);
          console.error("[Satellite] 洪水应急需求提报失败:", demandFailReason);
        }

        // 阻塞等待回调
        let callbackData: SliceCallbackPayload | null = null;
        let timeoutReason: string | undefined;
        if (demandOk) {
          console.log(`[Satellite] 等待洪水影像回调 ${CALLBACK_TIMEOUT_MS / 1000}s...`);
          const callbackPromise = registerSliceCallback(actualRequirementId);
          const timeoutPromise = sleep(CALLBACK_TIMEOUT_MS).then(() => null);
          try {
            callbackData = await Promise.race([callbackPromise, timeoutPromise]);
            if (callbackData) {
              console.log(`[Satellite] 收到洪水影像回调: ${callbackData.url}`);
            } else {
              timeoutReason = `未在 ${CALLBACK_TIMEOUT_MS / 1000}s 内收到外部回调`;
              console.log("[Satellite] 洪水影像回调超时，回退到本地影像");
            }
          } catch (err) {
            timeoutReason = err instanceof Error ? err.message : String(err);
            console.error("[Satellite] 等待洪水影像回调异常:", timeoutReason);
          } finally {
            cleanupSliceCallback(actualRequirementId);
          }
        }

        const imageUrl = callbackData?.url || "/local-tiles/post_flood.png";
        const isMock = !callbackData;
        const fallbackReason = demandFailReason || timeoutReason || "使用本地模拟影像";

        return {
          success: true,
          data: {
            message: isMock
              ? `已为您调度天基资源完成 **${regionName}** 暴雨后应急成像。\n\n| 指标 | 数值 |\n|------|------|\n| 影像数量 | 1 张 |\n| 分辨率 | 1m |\n| 云覆盖率 | <5% |\n| 卫星类型 | 高分六号 |\n| 覆盖范围 | 东经${SHIMEN_RECT.west}°–${SHIMEN_RECT.east}° / 北纬${SHIMEN_RECT.south}°–${SHIMEN_RECT.north}° |\n\n*${fallbackReason}，回退到本地模拟影像。*`
              : `已收到 **${regionName}** 暴雨后真实应急影像切片。\n\n| 指标 | 数值 |\n|------|------|\n| 影像来源 | ${callbackData.satellite} |\n| 分辨率 | ${callbackData.resolution}m |\n| 置信度 | ${callbackData.confidence} |\n| 回调ID | ${callbackData.id} |`,
            data: {
              type: "post_flood",
              responseType: "post_flood",
              imageCount: 1,
              resolution: isMock ? "1m" : `${callbackData.resolution}m`,
              satelliteType: isMock ? "高分六号" : callbackData.satellite,
              gisData: {
                type: "region",
                regions: [
                  {
                    id: "post-flood-imagery-bounds",
                    name: `${regionName} 暴雨后影像覆盖范围`,
                    type: "monitor",
                    coordinates: [
                      [SHIMEN_RECT.west, SHIMEN_RECT.south],
                      [SHIMEN_RECT.east, SHIMEN_RECT.south],
                      [SHIMEN_RECT.east, SHIMEN_RECT.north],
                      [SHIMEN_RECT.west, SHIMEN_RECT.north],
                      [SHIMEN_RECT.west, SHIMEN_RECT.south],
                    ] as [number, number][],
                    style: {
                      fill: false,
                      outlineColor: "#EF4444",
                      outlineWidth: 2,
                    },
                    label: {
                      text: "暴雨后影像范围",
                      position: [centerLng, centerLat] as [number, number],
                    },
                  },
                ],
                imageOverlays: [
                  {
                    id: "post-flood-imagery",
                    url: imageUrl,
                    rectangle: SHIMEN_RECT,
                    alpha: 0.9,
                    tileWidth: 691,
                    tileHeight: 502,
                  },
                ],
                cameraView: {
                  type: "point" as const,
                  lng: centerLng,
                  lat: centerLat,
                  altitude: 666,
                },
              },
            },
          },
          metadata: {
            capability: "satellite",
            executionTime: CALLBACK_TIMEOUT_MS,
            mock: isMock,
            responseType: "post_flood",
            requirementId,
            callBackUrl,
          },
        };
      }

      // phase 未指定，默认返回 pre
      return {
        success: true,
        data: {
          message: `洪水场景参数缺失，默认返回 ${regionName} 洪水前影像。`,
          data: {
            type: "pre_flood",
            responseType: "pre_flood",
            gisData: {
              type: "region",
              imageOverlays: [
                {
                  id: "pre-flood-imagery",
                  url: "/local-tiles/pre_flood.png",
                  rectangle: SHIMEN_RECT,
                  alpha: 0.9,
                  tileWidth: 691,
                  tileHeight: 502,
                },
              ],
              cameraView: {
                type: "point" as const,
                lng: centerLng,
                lat: centerLat,
                altitude: 666,
              },
            },
          },
        },
        metadata: {
          capability: "satellite",
          executionTime: 500,
          mock: true,
          responseType: "pre_flood",
        },
      };
    }

    // 情况0：油膜识别
    if (q.includes("油膜") || q.includes("油污") || (params as Record<string, unknown>).detectOilSpill === true) {
      // 从 context 中查找 region-mark 的结果（key = actionId）
      let regionName = "中国东海";
      for (const [, value] of Object.entries(_context || {})) {
        const v = value as Record<string, unknown> | undefined;
        if (v?.regionName) {
          regionName = String(v.regionName);
          break;
        }
      }

      const centerLng = 123.0125;
      const centerLat = 30.2561;
      const outline = [
        [123.00, 30.25], [123.02, 30.25], [123.03, 30.26],
        [123.01, 30.27], [122.99, 30.26], [123.00, 30.25],
      ];

      const oilSpillBounds = {
        west: 122.985,
        south: 30.238,
        east: 123.040,
        north: 30.274,
      };

      // 尝试获取真实影像 URL，失败则回退到 mock 图
      const realImageUrl = await fetchOilSpillImageUrl();
      const imageUrl = realImageUrl || "/satellite/oil-spill-1.png";

      const oilSpillData = {
        message: `天基遥感影像AI识别完成。在 **${regionName}** 区域发现疑似油膜区域。\n\n| 指标 | 数值 |\n|------|------|\n| 影像数量 | 32 张 |\n| 分辨率 | 0.8-1m |\n| 云覆盖率 | <8% |\n| 卫星类型 | SAR |\n| 油膜面积 | 0.3 km² |\n| 中心坐标 | 东经123°00′45″, 北纬30°15′22″ |`,
        data: {
          type: "oil_spill_detection",
          responseType: "oil_spill_detection",
          imageCount: 32,
          resolution: "0.8-1m",
          cloudCover: "<8%",
          satelliteType: "SAR",
          oilSpill: {
            areaKm2: 0.3,
            centerLng,
            centerLat,
            outline,
          },
          gisData: {
            type: "region",
            // 不输出 entities：satellite 是"识别到一片油膜"的区域事件，油膜中心坐标已在 message + region.label 给出，不需要再放点位 marker
            regions: [
              {
                id: "oil-spill-area",
                name: "疑似油膜区域",
                type: "monitor",
                coordinates: outline as [number, number][],
                style: {
                  fill: false,
                  outlineColor: "#FFAA00",
                  outlineWidth: 2,
                },
                label: {
                  text: "疑似油膜区域\n面积: 0.3km²",
                  position: [centerLng, centerLat] as [number, number],
                },
              },
              {
                id: "sar-image-bounds",
                name: "SAR影像范围",
                type: "monitor",
                coordinates: [
                  [oilSpillBounds.west, oilSpillBounds.south],
                  [oilSpillBounds.east, oilSpillBounds.south],
                  [oilSpillBounds.east, oilSpillBounds.north],
                  [oilSpillBounds.west, oilSpillBounds.north],
                  [oilSpillBounds.west, oilSpillBounds.south],
                ] as [number, number][],
                style: {
                  fill: false,
                  outlineColor: "#FF0000",
                  outlineWidth: 4,
                },
                label: {
                  text: "SAR影像范围",
                  position: [oilSpillBounds.east, oilSpillBounds.north] as [number, number],
                },
              },
            ],
            imageOverlays: [{
              id: "oil-spill-sar-1",
              url: imageUrl,
              rectangle: { west: 122.985, south: 30.238, east: 123.040, north: 30.274 },
              alpha: 0.85,
              tileWidth: 1402,
              tileHeight: 1122,
            }],
            cameraView: {
              type: "point" as const,
              lng: 123.014109,
              lat: 30.258168,
              altitude: 11967,
            },
          },
        },
      };

      return {
        success: true,
        data: oilSpillData,
        metadata: {
          capability: "satellite",
          executionTime: 3500,
          mock: true,
          responseType: "oil_spill_detection",
          mockImage: !realImageUrl,
        },
      };
    }

    // 情况1：历史数据查询（过去时间）
    if (q.includes("上个月") || q.includes("上周") || q.includes("2024") || q.includes("2025")) {
      const mockData = {
        message: `已为您检索到 **15** 条历史遥感数据，监测区域：东海，时间范围：上个月，产品类型：目标切片。`,
        table: `| 序号 | 卫星名称 | 载荷类型 | 目标类型 | 产品类型 | 采集时间 | 分辨率(m) | 置信度 | 预览 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 高分五号A星 | 红外 | 火情 | 目标切片 | 2026-03-15 10:22:05 | 1 | 0.85 | [查看](#) |
| 2 | 高分七号 | 可见光 | 船舰 | 目标切片 | 2026-03-14 14:30:12 | 0.65 | 0.92 | [查看](#) |
| 3 | 资源三号 | 多光谱 | 林火 | 标准影像 | 2026-03-12 09:15:33 | 2.1 | 0.78 | [查看](#) |
| 4 | 高分六号 | 红外 | 船舰 | 目标切片 | 2026-03-10 16:45:08 | 1 | 0.88 | [查看](#) |
| 5 | 高分五号B星 | 可见光 | 火情 | 目标切片 | 2026-03-08 11:20:55 | 1 | 0.91 | [查看](#) |`,
        data: {
          type: "history",
          record_id: 42,
          params: {
            location: "东海",
            start_time: "2026-03-01 00:00:00",
            end_time: "2026-03-31 23:59:59",
            time_desc: "上个月",
            info_type: "船舶监测",
            target_type: "船舰",
            product_type: "目标切片",
          },
          total: 15,
          records: [
            {
              id: "2037092947540324353",
              satelliteName: "高分五号A星",
              payloadType: "红外",
              targetType: "火情",
              productType: "目标切片",
              acquisitionTime: 1710424725000,
              resolution: 1,
              confidence: 0.85,
              centerLongitude: 122.5,
              centerLatitude: 30.8,
              previewUrl: "",
              width: 145,
              height: 132,
            },
            {
              id: "2037092947540324354",
              satelliteName: "高分七号",
              payloadType: "可见光",
              targetType: "船舰",
              productType: "目标切片",
              acquisitionTime: 1710336612000,
              resolution: 0.65,
              confidence: 0.92,
              centerLongitude: 121.8,
              centerLatitude: 29.5,
              previewUrl: "",
              width: 200,
              height: 180,
            },
          ],
          tianjian_req_id: null,
        },
      };

      return {
        success: true,
        data: mockData,
        metadata: {
          capability: "satellite",
          executionTime: 1500,
          mock: true,
          responseType: "history",
        },
      };
    }

    // 情况2：未来时间 → 需求提报
    if (q.includes("明天") || q.includes("下周") || q.includes("未来")) {
      const reqId = uuidv4().replace(/-/g, "");
      const mockData = {
        message: `当前暂无东海明天的历史遥感数据。

**需求提报成功！**

| 字段 | 内容 |
| --- | --- |
| 需求编号 | ${reqId} |
| 监测区域 | 东海 |
| 时间范围 | 明天 |
| 目标类型 | 船舰 |
| 产品类型 | 目标切片 |

系统将安排卫星进行观测，数据就绪后可再次查询。`,
        table: "",
        data: {
          type: "demand",
          record_id: 43,
          params: {
            location: "东海",
            time_desc: "明天",
            info_type: "舰船监测",
            target_type: "船舰",
            product_type: "目标切片",
            payload_mode: "光学影像",
          },
          total: 0,
          records: [],
          tianjian_req_id: reqId,
        },
      };

      return {
        success: true,
        data: mockData,
        metadata: {
          capability: "satellite",
          executionTime: 800,
          mock: true,
          responseType: "demand",
        },
      };
    }

    // 情况3：无历史数据且时间为过去
    if (q.includes("无数据") || q.includes("没有数据")) {
      const mockData = {
        message: "很抱歉，东海上周期间暂无相关历史遥感数据，且该时间段已过去，无法进行新的观测任务提报。如需其他时段数据，请重新查询。",
        table: "",
        data: {
          type: "no_data",
          record_id: 44,
          total: 0,
          records: [],
          tianjian_req_id: null,
        },
      };

      return {
        success: false,
        data: mockData,
        metadata: {
          capability: "satellite",
          executionTime: 600,
          mock: true,
          responseType: "no_data",
        },
      };
    }

    // 情况4：参数缺失
    if (q.includes("参数") || q.includes("缺少")) {
      const mockData = {
        message: "我需要更多信息：请提供具体的监测区域（如\"东海\"、\"渤海\"等）。",
        table: "",
        data: {
          type: "error",
          missing: "location",
        },
      };

      return {
        success: false,
        data: mockData,
        metadata: {
          capability: "satellite",
          executionTime: 300,
          mock: true,
          responseType: "error",
        },
      };
    }

    // 默认：返回历史数据（最常见场景）
    const mockData = {
      message: `已为您检索到 **8** 条历史遥感数据，监测区域：南海，时间范围：近期，产品类型：目标切片。`,
      table: `| 序号 | 卫星名称 | 载荷类型 | 目标类型 | 产品类型 | 采集时间 | 分辨率(m) | 置信度 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 高分六号 | 可见光 | 船舰 | 目标切片 | 2026-04-18 09:10:22 | 1 | 0.89 |
| 2 | 资源三号 | 多光谱 | 林火 | 标准影像 | 2026-04-17 14:25:18 | 2.1 | 0.76 |`,
      data: {
        type: "history",
        record_id: 45,
        params: {
          location: "南海",
          time_desc: "近期",
          info_type: "船舶监测",
          target_type: "船舰",
          product_type: "目标切片",
        },
        total: 8,
        records: [
          {
            id: "2037092947540324401",
            satelliteName: "高分六号",
            payloadType: "可见光",
            targetType: "船舰",
            productType: "目标切片",
            acquisitionTime: 1744938622000,
            resolution: 1,
            confidence: 0.89,
            centerLongitude: 113.2,
            centerLatitude: 18.5,
            previewUrl: "",
            width: 180,
            height: 160,
          },
        ],
        tianjian_req_id: null,
      },
    };

    return {
      success: true,
      data: mockData,
      metadata: {
        capability: "satellite",
        executionTime: 1200,
        mock: true,
        responseType: "history",
      },
    };
  },
};
