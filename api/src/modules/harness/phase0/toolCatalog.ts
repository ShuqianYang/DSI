/**
 * Phase 0 Tool Catalog
 *
 * 只向 Agent 暴露白名单工具的元信息（名称、描述、参数 schema、示例）。
 * 后续 Phase 1 接入 CapabilityContract 时，本文件中的手写 schema 可被自动化生成替代。
 */

export interface ToolCatalogItem {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  examples: Array<{ user: string; params: Record<string, unknown> }>;
}

export function buildToolCatalog(): ToolCatalogItem[] {
  return [
    {
      name: "weather-fetch",
      description:
        "获取指定区域的气象数据，包括风速、风向、洋流速度和方向。支持风场网格数据（供粒子层渲染）和单点洋流数据。默认区域为东海油膜片区。",
      inputSchema: {
        type: "object",
        properties: {
          region: {
            type: "string",
            description: "区域名称，例如 东海油膜片区、石门县、柳州 等",
          },
        },
        required: [],
      },
      examples: [
        {
          user: "查询东京今天的天气",
          params: { region: "东海油膜片区" },
        },
        {
          user: "北京今天会下雨吗",
          params: { region: "石门县" },
        },
      ],
    },
    {
      name: "news",
      description:
        "根据关键词实时搜索新闻和舆情信息，返回相关报道、趋势分析和关键实体。支持火山引擎搜索 + DeepSeek 格式化。",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "搜索关键词或用户原始问题",
          },
          keyword: {
            type: "string",
            description: "可选的精确关键词",
          },
          region: {
            type: "string",
            description: "可选的区域过滤，例如 南海、日本",
          },
          timeRange: {
            type: "string",
            description: "时间范围，例如 7d、30d",
          },
        },
        required: ["query"],
      },
      examples: [
        {
          user: "最近日本有没有地震相关报道",
          params: { query: "日本 地震", region: "日本", timeRange: "7d" },
        },
        {
          user: "南海最新局势",
          params: { query: "南海 局势", region: "南海", timeRange: "7d" },
        },
      ],
    },
  ];
}
