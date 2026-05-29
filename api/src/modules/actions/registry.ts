import type { Capability } from "./types.js";
import { maritimeCapability } from "./capabilities/maritime.js";
import { intelligenceCapability } from "./capabilities/intelligence.js";
// import { gisCapability } from "./capabilities/gis.js";
import { intelligentQaCapability } from "./capabilities/intelligent_qa.js";
import { dailyReportCapability } from "./capabilities/daily_report.js";
import { satelliteCapability } from "./capabilities/satellite.js";
import { subscriptionCapability } from "./capabilities/subscription.js";
import { requirementCapability } from "./capabilities/requirement.js";
import { newsCapability } from "./capabilities/news.js";
import { fireCapability } from "./capabilities/fire.js";
import { regionMarkCapability } from "./capabilities/region-mark.js";
import { weatherFetchCapability } from "./capabilities/weather-fetch.js";
import { oilDriftCapability } from "./capabilities/oil-drift.js";
import { aisFetchCapability } from "./capabilities/ais-fetch.js";
import { aisMatchSuspectsCapability } from "./capabilities/ais-match-suspects.js";
import { aisSuspectRankingCapability } from "./capabilities/ais-suspect-ranking.js";
import { borderPushCapability } from "./capabilities/border-push.js";
import { earthquakeEvaluationCapability } from "./capabilities/earthquake-evaluation.js";
import { floodEvaluationCapability } from "./capabilities/flood-evaluation.js";

const registry = new Map<string, Capability>();

export function registerCapability(type: string, capability: Capability): void {
  registry.set(type, capability);
}

export function getCapability(type: string): Capability | undefined {
  return registry.get(type);
}

export function listCapabilities(): Array<{ type: string; name: string; description: string }> {
  return Array.from(registry.entries()).map(([type, cap]) => ({
    type,
    name: cap.name,
    description: cap.description,
  }));
}

// 注册默认能力
registerCapability("maritime", maritimeCapability);
registerCapability("intelligence", intelligenceCapability);
// registerCapability("gis", gisCapability);
registerCapability("intelligent_qa", intelligentQaCapability);
registerCapability("daily_report", dailyReportCapability);
registerCapability("satellite", satelliteCapability);
registerCapability("subscription", subscriptionCapability);
registerCapability("requirement", requirementCapability);
registerCapability("news", newsCapability);
registerCapability("fire-detector", fireCapability);
registerCapability("region-mark", regionMarkCapability);
registerCapability("weather-fetch", weatherFetchCapability);
registerCapability("oil-drift", oilDriftCapability);
registerCapability("ais-fetch", aisFetchCapability);
registerCapability("ais-match-suspects", aisMatchSuspectsCapability);
registerCapability("ais-suspect-ranking", aisSuspectRankingCapability);
registerCapability("border-push", borderPushCapability);
registerCapability("earthquake-evaluation", earthquakeEvaluationCapability);
registerCapability("flood-evaluation", floodEvaluationCapability);
