import type { TemplateDefinition } from "../matchRegistry.js";
import { buildFinalizerParams } from "../finalizers/templateSummaryFinalizer.js";

/**
 * news.summary_template — 两步确定性 Template
 *
 * Step 1: news.search — 搜索新闻
 * Step 2: finalizer.template_summary — 基于搜索结果生成总结
 *
 * 步骤间通过 runtimeState.artifacts 传递数据。
 */

export const newsSummaryTemplate: TemplateDefinition = {
  id: "news.summary_template",
  kind: "template",
  displayName: "新闻搜索与总结",
  keywords: [
    "新闻",
    "报道",
    "最近",
    "事件",
    "灾害",
    "舆情",
    "动态",
    "资讯",
    "热点",
    "新闻总结",
    "新闻摘要",
    "最新报道",
    "事件追踪",
  ],
  whenToUse: [
    "用户需要搜索新闻并进行总结摘要",
    "用户关注某个话题的最新动态和舆情",
    "用户需要基于新闻数据做信息汇总",
  ],
  avoidWhen: [
    "用户只需要单一事实查询（如天气、股价）",
    "用户问题不涉及时间敏感的新闻信息",
  ],
  priority: 8,
  steps: [
    {
      stepKey: "search_news",
      tool: "news.search",
      buildParams: (state) => ({
        query: state.userQuery,
        timeRange: "7d",
        count: 5,
      }),
      saveAs: "news.search.results",
    },
    {
      stepKey: "summarize_news",
      tool: "finalizer.template_summary",
      buildParams: (state) => buildFinalizerParams(state, "news.search"),
    },
  ],
};
