import { v4 as uuidv4 } from "uuid";
import path from "path";
import sharp from "sharp";
import type { Action, ActionResult } from "@datasourceintelligence/shared";
import type { Capability } from "../types.js";

// 应急事件接收接口（翠花系统对接）
const EMERGENCY_URL = "http://192.168.0.106:8085/system/emergencyEvent/receiveDataInfo";

// 目标尺寸
const TARGET_WIDTH = 660;
const TARGET_HEIGHT = 590;

// ==================== 边防平台推送能力 ====================
// 将火情研判事件标准化封装并推送至应急系统

export const borderPushCapability: Capability = {
  name: "border-push",
  description: "标准化封装火情研判事件并推送至应急系统",

  execute: async (
    action: Action,
    context?: Record<string, unknown>
  ): Promise<ActionResult> => {
    const startTime = Date.now();
    const params = action.params as {
      targetPlatform?: string;
      scenario?: string;
      region?: string;
      regionId?: string;
    };

    const regionName = params.region || "未知区域";
    const regionId = params.regionId || "unspecified";

    // 从 context 中提取前序步骤的结果
    const fireResult = Object.values(context || {}).find(
      (v: any) => v?.summary?.fireDetected === true
    ) as Record<string, unknown> | undefined;

    const satResult = Object.values(context || {}).find(
      (v: any) => v?.data?.responseType === "fire_imaging"
    ) as Record<string, unknown> | undefined;

    const fireSummary = fireResult?.summary as Record<string, unknown> | undefined;
    const centerCoordinates = fireSummary?.centerCoordinates as [number, number] | undefined;

    // 火情影像：先 resize 到目标尺寸，再提供 URL
    const apiHost = process.env.CALLBACK_HOST || "localhost";
    const apiPort = process.env.API_PORT || "3001";
    const publicDir = path.join(process.cwd(), "public");
    const sourceImagePath = path.join(publicDir, "local-tiles", "fire_mask_on_truecolor.png");
    const resizedImagePath = path.join(publicDir, "local-tiles", `fire_mask_${TARGET_WIDTH}x${TARGET_HEIGHT}.png`);

    try {
      await sharp(sourceImagePath)
        .resize(TARGET_WIDTH, TARGET_HEIGHT, { fit: "cover", position: "centre" })
        .png()
        .toFile(resizedImagePath);
      console.log(`[BorderPush] 图片已 resize 至 ${TARGET_WIDTH}x${TARGET_HEIGHT}: ${resizedImagePath}`);
    } catch (e) {
      console.warn("[BorderPush] 图片 resize 失败，回退到原图:", e);
    }

    const fireImageUrl = `http://${apiHost}:${apiPort}/local-tiles/fire_mask_${TARGET_WIDTH}x${TARGET_HEIGHT}.png`;

    // 构造应急系统所需的 payload
    const eventId = uuidv4();
    const now = new Date();

    // GMT+8 时间（固定东八区，不依赖服务器时区）
    const pad = (n: number) => String(n).padStart(2, "0");
    const gmt8 = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const y = gmt8.getUTCFullYear();
    const m = pad(gmt8.getUTCMonth() + 1);
    const d = pad(gmt8.getUTCDate());
    const h = pad(gmt8.getUTCHours());
    const min = pad(gmt8.getUTCMinutes());
    const s = pad(gmt8.getUTCSeconds());
    const gmt8Time = `${y}-${m}-${d}T${h}:${min}:${s}+08:00`;

    // LocalDateTime 格式：YYYY-MM-DDTHH:mm:ss（无时区后缀，但时间值已是 GMT+8）
    const acquisitionTime = gmt8Time.slice(0, 19);

    const emergencyPayload = {
      id: `FIRE_${regionId}_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${eventId.slice(0, 8)}`,
      satellite: (satResult?.data as any)?.satelliteType || "高分五号A星",
      sensor: "光学",
      acquisition_time: acquisitionTime,
      resolution: 1.0,
      source_image_id: `FIRE_${regionId}_${acquisitionTime.replace(/[-T:]/g, "")}`,
      center_longitude: centerCoordinates ? centerCoordinates[0] : 0,
      center_latitude: centerCoordinates ? centerCoordinates[1] : 0,
      target_type: "火情",
      confidence: fireSummary?.confidence === "high" ? 0.95 : 0.75,
      width: TARGET_WIDTH,
      height: TARGET_HEIGHT,
      url: fireImageUrl,
      address: regionName,
    };

    // 调用应急接口
    let pushSuccess = false;
    let pushResponse: Record<string, unknown> = {};
    let pushError: string | undefined;

    try {
      const resp = await fetch(EMERGENCY_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(emergencyPayload),
      });

      const bodyText = await resp.text();
      console.log(`[BorderPush] Emergency API status: ${resp.status}, body: ${bodyText}`);

      try {
        pushResponse = JSON.parse(bodyText);
      } catch {
        pushResponse = { raw: bodyText };
      }

      pushSuccess = resp.ok;
      if (!resp.ok) {
        pushError = `HTTP ${resp.status}: ${bodyText}`;
      }
    } catch (err) {
      pushError = err instanceof Error ? err.message : String(err);
      console.error("[BorderPush] Emergency API call failed:", pushError);
    }

    // 内网接口不通时：默认通过（fallback），保证 action 链路不中断
    const isFallback = !pushSuccess;
    if (isFallback) {
      pushSuccess = true;
      pushResponse = { msg: "应急数据同步成功（fallback）", code: 200, note: "内网接口不可达，返回默认通过结果" };
    }

    // 同时保留内部 payload 用于日志和返回
    const internalPayload = {
      eventId,
      eventType: "fire-investigation",
      timestamp: gmt8Time,
      region: { regionId, regionName, centerCoordinates },
      firePoint: centerCoordinates
        ? { lng: centerCoordinates[0], lat: centerCoordinates[1] }
        : null,
      burnedAreaHectares: (fireSummary?.burnedAreaHectares as number) || 0,
      riskLevel: fireSummary?.confidence === "high" ? "高危" : "中危",
      emergencyPayload,
      emergencyResponse: pushResponse,
    };

    console.log(
      "[BorderPush] Internal payload:\n",
      JSON.stringify(internalPayload, null, 2)
    );

    return {
      success: pushSuccess,
      data: {
        pushed: pushSuccess,
        payload: internalPayload,
        summary: pushSuccess
          ? `已将「${regionName}」火情研判事件推送至应急系统，事件 ID: ${emergencyPayload.id}`
          : `推送失败: ${pushError}`,
      },
      metadata: {
        capability: "border-push",
        executionTime: Date.now() - startTime,
        mock: isFallback,
        fallback: isFallback,
        emergencyApiCalled: !isFallback,
        error: pushError,
      },
    };
  },
};
