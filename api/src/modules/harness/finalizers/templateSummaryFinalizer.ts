import type { HarnessRuntimeState } from "../../actions/contracts/types.js";

// ============================================================
// finalizer.template_summary — System Tool 实现
// ============================================================
//
// 不调用外部 API / LLM，纯规则模板生成总结。

export interface TemplateSummaryInput {
  sourceTool: string;
  query: string;
  items?: Array<Record<string, unknown>>;
  missingData?: string[];
}

export interface TemplateSummaryOutput {
  summary: string;
  keyFindings: string[];
  missingData: string[];
  suggestedNextAction: "final_answer" | "need_more_info" | "continue_search";
}

/**
 * 生成模板总结。
 *
 * 规则：
 * 1. 如果有 articles（新闻数据），提取标题和来源生成摘要
 * 2. 如果有 weather 数据，附加气象信息
 * 3. 如果没有 items，标记为 missingData
 */
export function generateTemplateSummary(
  input: TemplateSummaryInput
): TemplateSummaryOutput {
  const { sourceTool, query, items = [], missingData = [] } = input;

  const findings: string[] = [];
  let summary = "";

  // 根据 sourceTool 选择不同的总结策略
  if (sourceTool === "news.search") {
    if (items.length === 0) {
      summary = `针对「${query}」未检索到相关新闻资讯。`;
      findings.push("未找到匹配的新闻报道");
    } else {
      const titles = items
        .slice(0, 3)
        .map((item) => (item.title as string) || "无标题")
        .filter(Boolean);
      summary = `针对「${query}」检索到 ${items.length} 条新闻。主要报道包括：${titles.join("、")}。`;
      findings.push(`共检索到 ${items.length} 条新闻`);
      findings.push(...titles.slice(0, 3).map((t) => `报道：${t}`));
    }
  } else if (sourceTool === "weather.fetch") {
    const windInfo = items[0] as Record<string, unknown> | undefined;
    if (windInfo) {
      const desc =
        (windInfo.description as string) ||
        `${windInfo.windSpeed || ""} m/s ${windInfo.windDirection || ""}`;
      summary = `目标区域气象状况：${desc}。`;
      findings.push(`风速：${windInfo.windSpeed || "未知"}`);
      findings.push(`风向：${windInfo.windDirection || "未知"}`);
    } else {
      summary = `未获取到气象数据。`;
      findings.push("气象数据缺失");
    }
  } else {
    summary = `针对「${query}」的综合分析完成。共收集 ${items.length} 条数据。`;
    findings.push(`数据来源：${sourceTool}`);
    findings.push(`数据条目：${items.length}`);
  }

  return {
    summary,
    keyFindings: findings,
    missingData: missingData.length > 0 ? missingData : [],
    suggestedNextAction:
      missingData.length > 0 ? "need_more_info" : "final_answer",
  };
}

/**
 * 从 runtimeState 构建 finalizer 输入参数。
 */
export function buildFinalizerParams(
  state: HarnessRuntimeState,
  sourceTool: string
): Record<string, unknown> {
  // 从 artifacts 中读取前序步骤保存的数据
  const items = (state.artifacts[`${sourceTool}.results`] as
    | Array<Record<string, unknown>>
    | undefined) || [];

  return {
    sourceTool,
    query: state.userQuery,
    items,
    missingData: state.missingData,
  };
}
