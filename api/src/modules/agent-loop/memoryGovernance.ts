/**
 * MemoryGovernance (P1-9) - 治理规则注入 Prompt.
 *
 * Returns a PromptSection containing rules that guide the LLM on what to save
 * as memory, what not to save, and how to use recalled memory safely.
 */

import type { PromptSection } from "./tools/_shared/types.js";

const MEMORY_GOVERNANCE_SECTION_ID = "memory.governance";

export function buildMemoryGovernanceSection(): PromptSection {
  return {
    id: MEMORY_GOVERNANCE_SECTION_ID,
    content: [
      "# 记忆系统使用规则",
      "",
      "## 应该保存为记忆的内容",
      "- 用户角色、偏好、技能背景（user 类型）",
      "- 用户纠正和确认的行为指引（feedback 类型）",
      "- 任务结果中的重要发现和决策依据（episodic 类型）",
      "- 领域实体的新增信息和关系变更（semantic 类型）",
      "- 被验证有效的工具组合模式（procedural 类型）",
      "",
      "## 不应该保存为记忆的内容",
      "- 可从工具调用结果直接获取的实时数据",
      "- 临时调试信息、中间状态",
      "- 单次任务的常规执行细节（除非有特殊发现）",
      "- 任何包含敏感凭证的信息",
      "",
      "## 使用记忆时的规则",
      "1. 记忆是历史快照，可能已过时",
      "2. 在依赖记忆做判断前，用工具验证当前状态",
      "3. 如果记忆与当前观察矛盾，信任当前观察，并更新记忆",
      '4. 如果用户要求"忽略记忆"或"不要用记忆"：当做没有任何记忆来处理',
    ].join("\n"),
  };
}
