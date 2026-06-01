import type { SkillDefinition } from "../matchRegistry.js";

/**
 * weather.simple_query — 天气查询 skill
 *
 * 命中后直接调用 weather.fetch，零 LLM。
 * 从 query 中提取地点和日期参数。
 */

export const weatherSimpleSkill: SkillDefinition = {
  id: "weather.simple_query",
  kind: "skill",
  displayName: "天气查询",
  keywords: [
    "天气",
    "气温",
    "下雨",
    "降雨",
    "风速",
    "weather",
    "temperature",
    "rain",
    "wind",
    "东京",
    "北京",
    "上海",
    "大阪",
    "纽约",
    "伦敦",
  ],
  whenToUse: [
    "用户询问某个地点当前或指定日期的天气、气温、降雨、风速",
    "用户需要知道某地是否适合出行、穿衣建议",
  ],
  avoidWhen: [
    "用户需要灾害评估、火情分析、洪水影响评估",
    "用户询问长期气候趋势或历史气象统计",
    "用户需要气象数据做科学建模",
  ],
  priority: 10,
  tool: "weather.fetch",
  buildParams: (query, _context) => ({
    location: extractLocation(query),
    date: extractDate(query),
  }),
};

// ========== 参数提取辅助函数 ==========

function extractLocation(query: string): string {
  const regions = [
    "东京",
    "北京",
    "上海",
    "大阪",
    "纽约",
    "伦敦",
    "东海",
    "南海",
    "日本",
    "中国",
  ];
  for (const region of regions) {
    if (query.includes(region)) return region;
  }
  return "北京"; // 默认
}

function extractDate(query: string): string {
  if (query.includes("后天")) return "day_after_tomorrow";
  if (query.includes("明天")) return "tomorrow";
  if (query.includes("昨天")) return "yesterday";
  return "today";
}
