import { z } from "zod";
import path from "path";
import sharp from "sharp";
import { v4 as uuidv4 } from "uuid";
import type { ToolDefinition } from "../../_shared/types.js";
import {
  BURNED_AREA_HECTARES,
  CONFIDENCE,
  FIRE_CENTER_LAT,
  FIRE_CENTER_LNG,
  FIRE_TYPE,
} from "./mockData.js";

const InputSchema = z.strictObject({
  region: z.string().trim().min(1).default("Kensai"),
  targetPlatform: z.string().trim().min(1).default("border-defense"),
});

type BorderPushInput = z.infer<typeof InputSchema>;

// 应急事件接收接口（翠花系统对接）
const EMERGENCY_URL = "http://192.168.0.106:8085/system/emergencyEvent/receiveDataInfo";

const TARGET_WIDTH = 660;
const TARGET_HEIGHT = 590;

export function buildBorderPushMockTool(): ToolDefinition {
  return {
    name: "BorderPushMock",
    displayName: "边境推送",
    aliases: ["border-push-mock"],
    description:
      "Deterministic mock border-platform push for the Kensai fire demo. Attempts to POST the fire investigation event to the emergency system; if the network is unreachable, returns a fallback success so the demo flow continues.",
    kind: "domain",
    inputSchema: InputSchema,
    isReadOnly: () => false,
    isDestructive: () => false,
    isConcurrencySafe: () => true,
    riskLevel: "low",
    async execute(input) {
      const parsed = input as BorderPushInput;
      const startTime = Date.now();

      const apiHost = process.env.CALLBACK_HOST || "localhost";
      const apiPort = process.env.API_PORT || "3001";
      const publicDir = path.join(process.cwd(), "public");
      const sourceImagePath = path.join(publicDir, "local-tiles", "fire_mask_on_truecolor.png");
      const resizedImagePath = path.join(
        publicDir,
        "local-tiles",
        `fire_mask_${TARGET_WIDTH}x${TARGET_HEIGHT}.png`,
      );

      try {
        await sharp(sourceImagePath)
          .resize(TARGET_WIDTH, TARGET_HEIGHT, { fit: "cover", position: "centre" })
          .png()
          .toFile(resizedImagePath);
      } catch (e) {
        console.warn("[BorderPushMock] Image resize failed, using original:", e);
      }

      const fireImageUrl = `http://${apiHost}:${apiPort}/local-tiles/fire_mask_${TARGET_WIDTH}x${TARGET_HEIGHT}.png`;

      const eventId = uuidv4();
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      const gmt8 = new Date(now.getTime() + 8 * 60 * 60 * 1000);
      const y = gmt8.getUTCFullYear();
      const m = pad(gmt8.getUTCMonth() + 1);
      const d = pad(gmt8.getUTCDate());
      const h = pad(gmt8.getUTCHours());
      const min = pad(gmt8.getUTCMinutes());
      const s = pad(gmt8.getUTCSeconds());
      const gmt8Time = `${y}-${m}-${d}T${h}:${min}:${s}+08:00`;
      const acquisitionTime = gmt8Time.slice(0, 19);

      const emergencyPayload = {
        id: `FIRE_${parsed.region}_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${eventId.slice(0, 8)}`,
        satellite: "高分五号A星",
        sensor: "光学",
        acquisition_time: acquisitionTime,
        resolution: 1.0,
        source_image_id: `FIRE_${parsed.region}_${acquisitionTime.replace(/[-T:]/g, "")}`,
        center_longitude: FIRE_CENTER_LNG,
        center_latitude: FIRE_CENTER_LAT,
        target_type: "火情",
        confidence: CONFIDENCE === "high" ? 0.95 : 0.75,
        width: TARGET_WIDTH,
        height: TARGET_HEIGHT,
        url: fireImageUrl,
        address: parsed.region,
      };

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
      }

      const isFallback = !pushSuccess;
      if (isFallback) {
        pushSuccess = true;
        pushResponse = {
          msg: "应急数据同步成功（fallback）",
          code: 200,
          note: "内网接口不可达，返回默认通过结果",
        };
      }

      const internalPayload = {
        eventId,
        eventType: "fire-investigation",
        timestamp: gmt8Time,
        region: { regionName: parsed.region, centerCoordinates: [FIRE_CENTER_LNG, FIRE_CENTER_LAT] },
        firePoint: { lng: FIRE_CENTER_LNG, lat: FIRE_CENTER_LAT },
        burnedAreaHectares: BURNED_AREA_HECTARES,
        riskLevel: CONFIDENCE === "high" ? "高危" : "中危",
        targetPlatform: parsed.targetPlatform,
        emergencyPayload,
        emergencyResponse: pushResponse,
      };

      return {
        summary: pushSuccess
          ? `已将「${parsed.region}」火情研判事件推送至应急系统，事件 ID: ${emergencyPayload.id}`
          : `推送失败: ${pushError}`,
        region: parsed.region,
        pushed: pushSuccess,
        payload: internalPayload,
        fallback: isFallback,
        gisData: {
          type: "entity" as const,
          entities: [
            {
              id: "border-push-marker",
              name: `${parsed.region} 推送落点`,
              type: "fire",
              coordinates: [FIRE_CENTER_LNG, FIRE_CENTER_LAT] as [number, number],
              importance: "high",
              status: "danger",
              description: `火情研判结果已推送 | ${FIRE_TYPE} | 烧毁 ${BURNED_AREA_HECTARES} 公顷`,
            },
          ],
        },
        metadata: {
          capability: "border-push",
          mock: true,
          fallback: isFallback,
          emergencyApiCalled: !isFallback,
          executionTime: Date.now() - startTime,
          error: pushError,
        },
      };
    },
  };
}
