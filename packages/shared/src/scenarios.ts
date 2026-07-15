import { z } from "zod";

export const ScenarioIdSchema = z.enum(["osint", "marine", "emergency", "border"]);
export type ScenarioId = z.infer<typeof ScenarioIdSchema>;

export const ScenarioMapLayerIdSchema = z.enum(["ais", "ads"]);
export type ScenarioMapLayerId = z.infer<typeof ScenarioMapLayerIdSchema>;

export interface ScenarioQuickAction {
  label: string;
  prompt: string;
}

export interface ScenarioProfile {
  id: ScenarioId;
  name: string;
  description: string;
  chatTitle: string;
  chatSubtitle: string;
  greetingTitle: string;
  greetingDescription: string;
  inputPlaceholder: string;
  switchMessage: string;
  quickActions: ScenarioQuickAction[];
  mapLayers: ScenarioMapLayerId[];
  skillIds: string[];
}

export const DEFAULT_SCENARIO_ID: ScenarioId = "osint";

export const SCENARIOS: readonly ScenarioProfile[] = [
  {
    id: "osint",
    name: "开源情报",
    description: "整合互联网舆情工具、开源船舶数据和开源航班数据，支撑统一检索与关联分析。",
    chatTitle: "开源情报助手",
    chatSubtitle: "船舶、航班与公开信息关联检索",
    greetingTitle: "您好，我是开源情报助手",
    greetingDescription: "我可以帮您检索 AIS 船舶、ADS-B 航班与区域态势，并支持后续舆情关联分析。",
    inputPlaceholder: "输入船舶、航班、区域或开源情报问题...",
    switchMessage: "已切换到「开源情报」场景，当前将优先使用船舶、航班与开源检索能力。",
    quickActions: [
      {
        label: "东海船舶态势",
        prompt: "查询东海区域 AIS 船舶态势，统计船舶数量、类型和异常目标。",
      },
      {
        label: "华东航班态势",
        prompt: "查询华东区域 ADS-B 航班态势，统计空中航空器数量和异常信号。",
      },
    ],
    mapLayers: ["ais", "ads"],
    skillIds: ["ais-region-query", "aircraft-region-query"],
  },
  {
    id: "marine",
    name: "海洋",
    description: "围绕漏油排查场景，构建油污识别、漂移推演、嫌疑船匹配与溯源能力。",
    chatTitle: "海洋漏油排查助手",
    chatSubtitle: "油污识别、漂移推演与嫌疑船溯源",
    greetingTitle: "您好，我是海洋漏油排查助手",
    greetingDescription: "我可以帮您触发油污溯源演示，并结合海事目标进行嫌疑船关联分析。",
    inputPlaceholder: "输入漏油、油膜、漂移或海事溯源问题...",
    switchMessage: "已切换到「海洋」场景，当前将优先使用漏油识别、溯源和海事关联分析能力。",
    quickActions: [
      {
        label: "东海油污溯源演示",
        prompt: "/演示:油污溯源 中国东海 2026-06-01 疑似溢油",
      },
    ],
    mapLayers: [],
    skillIds: ["oil-spill-tracing"],
  },
  {
    id: "emergency",
    name: "应急",
    description: "联动互联网灾情检索与天机影像能力，串接地震、火灾场景的 Skill 链。",
    chatTitle: "应急灾情研判助手",
    chatSubtitle: "灾情检索、天机影像与损毁评估",
    greetingTitle: "您好，我是应急灾情研判助手",
    greetingDescription: "我可以帮您触发地震、火灾灾后评估链路，并在地图上展示受灾区域与影像结果。",
    inputPlaceholder: "输入地震、火灾、灾情影像或应急决策问题...",
    switchMessage: "已切换到「应急」场景，当前将优先使用灾情检索、天机影像和灾后评估能力。",
    quickActions: [
      {
        label: "柳州地震灾后评估演示",
        prompt: "/演示:地震灾后评估 广西柳州市柳南区 6.2级地震",
      },
      {
        label: "石门县洪水灾后评估演示",
        prompt: "/演示:洪水灾后评估 湖南石门县",
      },
    ],
    mapLayers: [],
    skillIds: ["earthquake-assessment", "flood-assessment"],
  },
  {
    id: "border",
    name: "边防",
    description: "基于多源边防数据生成日报和分析材料，并复用火情识别能力加强边境区域监测。",
    chatTitle: "边防态势分析助手",
    chatSubtitle: "边防数据问答、日报生成与告警处置",
    greetingTitle: "您好，我是边防态势分析助手",
    greetingDescription: "我可以帮您查询边防告警与设备数据、生成日报，并触发火情识别能力支撑边境监测。",
    inputPlaceholder: "输入边防告警、设备、日报或巡逻处置问题...",
    switchMessage: "已切换到「边防」场景，当前将优先使用边防数据问答、日报生成和告警处置能力。",
    quickActions: [
      {
        label: "生成今日边防日报",
        prompt: "生成今天的边防安防日报，报告类型为总体。",
      },
      {
        label: "Kensai 火情研判演示",
        prompt: "/演示:火情研判 Kensai 森林火灾",
      },
    ],
    mapLayers: [],
    skillIds: ["border-defense-qa", "border-defense-daily-report", "alarm-disposal-orchestrator", "fire-investigation"],
  },
];

export function isScenarioId(value: unknown): value is ScenarioId {
  return ScenarioIdSchema.safeParse(value).success;
}

export function getScenarioProfile(value?: unknown): ScenarioProfile {
  const scenarioId = isScenarioId(value) ? value : DEFAULT_SCENARIO_ID;
  return SCENARIOS.find((scenario) => scenario.id === scenarioId) ?? SCENARIOS[0];
}

export function getSkillScenarioUsage(skillId: string): Array<Pick<ScenarioProfile, "id" | "name">> {
  return SCENARIOS
    .filter((scenario) => scenario.skillIds.includes(skillId))
    .map(({ id, name }) => ({ id, name }));
}
