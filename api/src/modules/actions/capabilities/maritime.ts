import { v4 as uuidv4 } from "uuid";
import type {
  Action,
  ActionResult,
  MaritimeVessel,
  MaritimeSummary,
} from "@datasourceintelligence/shared";
import type { Capability } from "../types.js";
import { callDifyChat } from "../../../lib/dify.js";
import {
  getAisEntitiesInRegion,
  getAisHighRiskEntities,
  getAisAnomalies,
  getAisTrajectoriesByIds,
  getRegionBounds,
  getRegionDataSourceSummary,
  getRegionDataTimestamp,
  getNearbyRegions,
  type AisEntity,
  type AisAnomaly,
} from "../../../data/aisDataStore.js";
import {
  getAdsEntitiesInRegion,
  getAdsHighRiskEntities,
  getAdsAnomalies,
  getAdsTrajectoriesByIds,
  type AdsEntity,
  type AdsAnomaly,
} from "../../../data/adsDataStore.js";

// ==================== JSON 解析器（容错） ====================
function parseMaritimeResult(answer: string): {
  vessels: MaritimeVessel[];
  summary: MaritimeSummary;
} {
  try {
    let cleaned = answer.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/```(?:json)?\s*/, "").replace(/\s*```$/, "");
    }
    const parsed = JSON.parse(cleaned);
    return {
      vessels: Array.isArray(parsed.vessels) ? parsed.vessels : [],
      summary: parsed.summary || {},
    };
  } catch {
    const match = answer.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        return {
          vessels: Array.isArray(parsed.vessels) ? parsed.vessels : [],
          summary: parsed.summary || {},
        };
      } catch {
        // ignore
      }
    }
    return { vessels: [], summary: {} as MaritimeSummary };
  }
}

// ==================== Prompt Preamble 构建器 ====================
interface MaritimePromptContext {
  region: string;
  regionBounds: { minLng: number; maxLng: number; minLat: number; maxLat: number } | null;
  dataTimestamp: number;
  totalVessels: number;
  dataSourceSummary: { aisStream: number; shipdt: number; mock: number };
}

function buildMaritimePrompt(query: string, ctx: MaritimePromptContext): string {
  const boundsText = ctx.regionBounds
    ? `数据范围：经度 ${ctx.regionBounds.minLng}°–${ctx.regionBounds.maxLng}°，纬度 ${ctx.regionBounds.minLat}°–${ctx.regionBounds.maxLat}°。`
    : "";

  const timestampText = ctx.dataTimestamp > 0
    ? `数据更新时间：${new Date(ctx.dataTimestamp).toISOString()}（共 ${ctx.totalVessels} 艘船舶）。`
    : `当前共监测到 ${ctx.totalVessels} 艘船舶。`;

  const sourceParts: string[] = [];
  if (ctx.dataSourceSummary.aisStream > 0) sourceParts.push(`AISStream 实时信号 ${ctx.dataSourceSummary.aisStream} 艘`);
  if (ctx.dataSourceSummary.shipdt > 0) sourceParts.push(`ShipDT 补充 ${ctx.dataSourceSummary.shipdt} 艘`);
  if (ctx.dataSourceSummary.mock > 0) sourceParts.push(`模拟数据 ${ctx.dataSourceSummary.mock} 艘`);
  const sourceText = sourceParts.length > 0 ? `数据来源：${sourceParts.join("、")}。` : "";

  return `你正在分析 ${ctx.region} 的实时船舶态势。\n${boundsText}\n${timestampText}\n${sourceText}\n\n用户问题：${query}\n\n请基于以下实时数据进行分析，给出结构化评估：`;
}

// ==================== 统一 Summary 生成（确保文本与地图数据一致） ====================
function generateSummary(
  region: string,
  allVessels: AisEntity[],
  vessels: MaritimeVessel[],
  vesselAnomalies: AisAnomaly[],
  totalAircrafts: number = 0
): MaritimeSummary {
  const normalCount = vessels.filter((v) => v.status === "normal").length;
  const warningCount = vessels.filter((v) => v.status === "warning").length;
  const dangerCount = vessels.filter((v) => v.status === "danger").length;

  const dangerVessels = vessels.filter((v) => v.status === "danger");
  const warningVessels = vessels.filter((v) => v.status === "warning");

  // 列出具体关注船舶名称（最多列 6 艘，避免过长）
  const vesselNames = [
    ...dangerVessels.map((v) => `${v.name}（危险）`),
    ...warningVessels.map((v) => `${v.name}（警告）`),
  ].slice(0, 6);

  const anomalyDesc = vesselAnomalies
    .slice(0, 3)
    .map((a) => a.description)
    .join("；");

  const riskAssessment =
    `${region}当前态势评估：共监测到${allVessels.length}艘船舶，关注目标${vessels.length}艘` +
    (vesselNames.length > 0 ? `：${vesselNames.join("、")}` : "") +
    `，其中危险${dangerCount}艘、警告${warningCount}艘。` +
    (anomalyDesc ? `主要异常：${anomalyDesc}。` : "") +
    `建议对危险及警告目标保持实时追踪。`;

  return {
    totalVessels: vessels.length,
    totalAircrafts,
    normalCount,
    warningCount,
    dangerCount,
    riskAssessment,
  };
}

// ==================== Fallback 数据组装 ====================
function buildFallbackResult(
  region: string,
  highRiskVessels: AisEntity[],
  allVessels: AisEntity[],
  vesselAnomalies: AisAnomaly[]
): {
  vessels: MaritimeVessel[];
  summary: MaritimeSummary;
} {
  const vessels: MaritimeVessel[] = highRiskVessels.map((v) => ({
    ...v,
    reason: `本地风险筛查标记为 ${v.riskLevel} / ${v.status}`,
  }));

  const summary = generateSummary(region, allVessels, vessels, vesselAnomalies);
  return { vessels, summary };
}

// ==================== GIS 图层构建 ====================
function buildGisLayers(
  vesselTrajectories: ReturnType<typeof getAisTrajectoriesByIds>,
  aircraftTrajectories?: ReturnType<typeof getAdsTrajectoriesByIds>
) {
  const vesselTrajectoryData = vesselTrajectories.map((t) => ({
    vesselId: t.id,
    points: t.points,
  }));

  const aircraftTrajectoryData = (aircraftTrajectories || []).map((t) => ({
    vesselId: t.id,
    points: t.points,
  }));

  return {
    trajectories: {
      type: "line" as const,
      data: [...vesselTrajectoryData, ...aircraftTrajectoryData],
    },
  };
}

// ==================== Capability 定义 ====================
export const maritimeCapability: Capability = {
  name: "maritime",
  description: "海域态势分析：基于 AIS 实时数据，识别异常行为、评估风险等级",

  execute: async (
    action: Action,
    _context?: Record<string, unknown>
  ): Promise<ActionResult> => {
    const startTime = Date.now();
    const params = action.params as { region?: string; query?: string };
    const rawRegion = params.region || "";
    const query = params.query || `分析${rawRegion || "东海"}近期态势`;

    // 解析并校验 region：如果无法匹配已知海域，尝试从 query 中提取，否则回退到 "南海"
    const KNOWN_SEAS = [
      // 中国近海
      "渤海", "黄海", "东海北部", "东海南部", "东海", "台湾海峡",
      "南海北部", "南海南部", "南海", "北部湾", "日本海", "日本海北部",
      "菲律宾海", "菲律宾海东部",
      // 东南亚 / 印度洋
      "马六甲海峡", "印度洋", "印度洋北部", "印度洋中部", "孟加拉湾", "阿拉伯海",
      // 中东
      "波斯湾", "红海", "亚丁湾",
      // 地中海 / 苏伊士
      "地中海", "地中海东部", "地中海西部", "苏伊士运河",
      // 西太平洋扩展
      "西太平洋", "鄂霍次克海",
    ];
    function resolveRegion(raw: string, q: string): string {
      for (const sea of KNOWN_SEAS) {
        if (raw.includes(sea)) return sea;
      }
      for (const sea of KNOWN_SEAS) {
        if (q.includes(sea)) return sea;
      }
      return "南海";
    }
    const region = resolveRegion(rawRegion, query);

    // 1. 获取全量实时数据（船舶 + 飞机）
    const allVessels = getAisEntitiesInRegion(region);
    const allAircrafts = getAdsEntitiesInRegion(region);

    // 2. 本地风险筛选与异常检测
    const highRiskVessels = getAisHighRiskEntities(region);
    const vesselAnomalies = getAisAnomalies(region);
    const highRiskAircrafts = getAdsHighRiskEntities(region);
    const aircraftAnomalies = getAdsAnomalies(region);

    const highRiskVesselIds = new Set(highRiskVessels.map((v) => v.id));

    // 日志：输出本地高危船舶明细，便于与 Dify 返回及前端 base 数据对比
    console.log(`[Maritime] Local highRiskVessels for region=${region}:`);
    for (const v of highRiskVessels) {
      console.log(`  ${v.id} | ${v.name} | status=${v.status} | riskLevel=${v.riskLevel} | lat=${v.lat}, lng=${v.lng}`);
    }

    // 3. 调用 Dify Agent（带 fallback）
    let vessels: MaritimeVessel[];
    let summary: MaritimeSummary;

    const difyApiKey = process.env.DIFY_MARITIME_API_KEY;
    const difyApiUrl = process.env.DIFY_MARITIME_API_URL;

    if (difyApiKey && difyApiUrl) {
      try {
        const stats = {
          totalVessels: allVessels.length,
          normalCount: allVessels.filter((v) => v.status === "normal").length,
          warningCount: allVessels.filter((v) => v.status === "warning").length,
          dangerCount: allVessels.filter((v) => v.status === "danger").length,
          avgSpeed: allVessels.length > 0
            ? parseFloat((allVessels.reduce((sum, v) => sum + v.speed, 0) / allVessels.length).toFixed(1))
            : 0,
        };

        const regionBounds = getRegionBounds(region);
        const dataTimestamp = getRegionDataTimestamp(region);
        const dataSourceSummary = getRegionDataSourceSummary(region);
        const nearbyRegions = getNearbyRegions(region);

        const enrichedQuery = buildMaritimePrompt(query, {
          region,
          regionBounds,
          dataTimestamp,
          totalVessels: allVessels.length,
          dataSourceSummary,
        });

        const result = await callDifyChat({
          apiKey: difyApiKey,
          apiUrl: difyApiUrl,
          query: enrichedQuery,
          timeoutMs: 120_000,
          inputs: {
            region,
            regionBounds,
            query,
            dataTimestamp: dataTimestamp > 0 ? new Date(dataTimestamp).toISOString() : "N/A",
            dataSourceSummary,
            stats,
            highRiskVessels,
            anomalies: vesselAnomalies.map((a) => ({
              entityId: a.entityId,
              entityName: a.entityName,
              type: a.type,
              severity: a.severity,
              description: a.description,
            })),
            nearbyRegions,
          },
        });

        console.log("[Maritime] Dify raw answer:\n", result.answer);
        const parsed = parseMaritimeResult(result.answer);

        if (parsed.vessels.length > 0) {
          vessels = parsed.vessels;
          summary = parsed.summary as MaritimeSummary;

          // 日志：Dify 返回的原始 vessels 明细
          console.log("[Maritime] Dify raw vessels detail:");
          for (const v of vessels) {
            console.log(`  ${v.id} | ${v.name} | status=${v.status} | riskLevel=${v.riskLevel}`);
          }

          // ====== 关键校验：过滤 Dify 幻觉 / 修正属性 ======
          // 1. 只保留 ID 存在于本地 allVessels 中的船（过滤 Dify 编造的船）
          // 2. 用本地数据覆盖 name/lat/lng/speed/heading/status/riskLevel，只保留 Dify 的 reason
          //    防止 Dify 把正常船标记成危险，或修改坐标导致地图漂移
          const allVesselsMap = new Map(allVessels.map((v) => [v.id, v]));
          const filteredVessels: MaritimeVessel[] = [];
          const droppedVesselIds: string[] = [];

          for (const dv of vessels) {
            const local = allVesselsMap.get(dv.id);
            if (!local) {
              // Dify 返回了本地不存在的船（幻觉），丢弃
              droppedVesselIds.push(dv.id);
              continue;
            }
            // 如果 Dify 把 status 改成了 normal，但它本来就在 highRiskVessels 中，强制恢复
            // 如果 Dify 把非高危船标记成了 warning/danger，也信任本地状态
            const correctedStatus = local.status;
            const correctedRiskLevel = local.riskLevel;
            filteredVessels.push({
              ...local,
              status: correctedStatus,
              riskLevel: correctedRiskLevel,
              reason: dv.reason || `Dify 分析标记`,
            });
          }

          if (droppedVesselIds.length > 0) {
            console.warn(`[Maritime] Dify 返回了 ${droppedVesselIds.length} 艘本地不存在的船，已过滤:`, droppedVesselIds);
          }

          vessels = filteredVessels;
          // ====== 校验结束 ======

          // 补充 Dify 可能遗漏的高危实体（硬性规则：warning/danger 必须全部覆盖）
          console.log(`[Maritime] Dify returned vessels=${parsed.vessels.length}, after filter=${vessels.length}`);
          console.log(`[Maritime] Local highRiskVessels=${highRiskVessels.length}`);
          const existingVesselIds = new Set(vessels.map((v) => v.id));
          for (const v of highRiskVessels) {
            if (!existingVesselIds.has(v.id)) {
              vessels.push({
                ...v,
                reason: `本地风险筛查标记为 ${v.riskLevel} / ${v.status}`,
              });
            }
          }
          console.log(`[Maritime] After merge: vessels=${vessels.length}`);

          // 合并后统一重新生成 summary，确保文本与地图数据完全一致
          summary = generateSummary(region, allVessels, vessels, vesselAnomalies);

          // 日志：输出最终返回的 vessels 明细，便于前端对比
          console.log("[Maritime] Final vessels detail:");
          for (const v of vessels) {
            console.log(`  ${v.id} | ${v.name} | status=${v.status} | riskLevel=${v.riskLevel} | lat=${v.lat}, lng=${v.lng}`);
          }
        } else {
          console.log("[Maritime] Dify returned empty vessels, using fallback.");
          const fallback = buildFallbackResult(
            region,
            highRiskVessels,
            allVessels,
            vesselAnomalies
          );
          vessels = fallback.vessels;
          summary = fallback.summary;
          console.log("[Maritime] Empty fallback. Final vessels:");
          for (const v of vessels) {
            console.log(`  ${v.id} | ${v.name} | status=${v.status} | riskLevel=${v.riskLevel}`);
          }
        }
      } catch (err) {
        console.error("[Maritime] Dify call failed, using fallback:", err);
        const fallback = buildFallbackResult(
          region,
          highRiskVessels,
          allVessels,
          vesselAnomalies
        );
        vessels = fallback.vessels;
        summary = fallback.summary;
        console.log("[Maritime] Dify error fallback. Final vessels:");
        for (const v of vessels) {
          console.log(`  ${v.id} | ${v.name} | status=${v.status} | riskLevel=${v.riskLevel}`);
        }
      }
    } else {
      // Dify 未配置，使用本地筛选结果
      const fallback = buildFallbackResult(
        region,
        highRiskVessels,
        allVessels,
        vesselAnomalies
      );
      vessels = fallback.vessels;
      summary = fallback.summary;
      console.log("[Maritime] Fallback mode (Dify not configured). Final vessels:");
      for (const v of vessels) {
        console.log(`  ${v.id} | ${v.name} | status=${v.status} | riskLevel=${v.riskLevel}`);
      }
    }

    // 4. 最终过滤：只保留 warning/danger 船舶，防止 Dify 误标或修正后仍为 normal 的船进入结果
    const beforeFinalFilter = vessels.length;
    vessels = vessels.filter((v) => v.status !== "normal");
    if (vessels.length < beforeFinalFilter) {
      console.log(`[Maritime] Final filter: removed ${beforeFinalFilter - vessels.length} normal vessels, keeping ${vessels.length} warning/danger vessels`);
      // 重新生成 summary，确保计数正确
      summary = generateSummary(region, allVessels, vessels, vesselAnomalies);
    }

    // 5. 生成 GIS 回显数据（船舶 + 飞机轨迹）
    const highRiskVesselIdsFinal = new Set(vessels.map((v) => v.id));
    const highRiskAircraftIdsFinal = new Set(highRiskAircrafts.map((a) => a.id));
    const vesselTrajectories = getAisTrajectoriesByIds([...highRiskVesselIdsFinal]);
    const aircraftTrajectories = getAdsTrajectoriesByIds([...highRiskAircraftIdsFinal]);
    const gisLayers = buildGisLayers(vesselTrajectories, aircraftTrajectories);

    // 6. 组装 aircrafts（ MaritimeAircraft 格式）
    const aircrafts = highRiskAircrafts.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      lat: a.lat,
      lng: a.lng,
      altitude: a.altitude,
      speed: a.speed,
      heading: a.heading,
      status: a.status,
      riskLevel: a.riskLevel,
      reason: `本地风险筛查标记为 ${a.riskLevel} / ${a.status}`,
    }));

    // 7. 组装 ActionResult
    const data = {
      region,
      analysisId: uuidv4(),
      timestamp: new Date().toISOString(),
      vessels,
      aircrafts,
      summary: { ...summary, totalAircrafts: allAircrafts.length },
      gisLayers,
    };

    return {
      success: true,
      data,
      metadata: {
        capability: "maritime",
        executionTime: Date.now() - startTime,
        source: difyApiKey ? "dify" : "local",
      },
    };
  },
};
