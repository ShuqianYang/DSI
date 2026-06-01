import type { CapabilityContract, Observation } from "../actions/contracts/types.js";

// ============================================================
// 候选工具检索 — top-k 语义排序
// ============================================================

export interface RetrieveOptions {
  /** 是否允许返回 sideEffect = write 的工具 */
  allowWriteTools?: boolean;
  /** 返回工具数量上限，默认 3 */
  topK?: number;
}

interface ScoredTool {
  contract: CapabilityContract;
  score: number;
  reasons: string[];
}

/**
 * 根据当前 query 和已有 observations 检索候选工具，返回 top-k。
 *
 * 打分规则：
 * - name / displayName / description / llm.whenToUse 命中 query 关键词：+2 分/词
 * - observation 文本命中 description / whenToUse：+1 分/词
 * - llm.avoidWhen 命中：-3 分/词
 * - 无 contract 的工具：排除
 * - sideEffect = write 且 allowWriteTools = false：排除
 *
 * 默认 topK = 3，只返回得分最高的工具。
 */
export function retrieveCandidateTools(
  query: string,
  observations: Observation[],
  registry: Map<string, CapabilityContract>,
  options?: RetrieveOptions
): CapabilityContract[] {
  const { allowWriteTools = false, topK = 3 } = options ?? {};
  const lowerQuery = query.toLowerCase();
  const scored: ScoredTool[] = [];

  for (const contract of registry.values()) {
    // 1. 排除 write 工具（除非显式允许）
    if (!allowWriteTools && contract.execution.sideEffect === "write") {
      continue;
    }

    // 2. 计算得分
    const result = scoreTool(contract, lowerQuery, observations);

    // 3. 负分或零分的工具不返回
    if (result.score <= 0) {
      continue;
    }

    scored.push({ contract, score: result.score, reasons: result.reasons });
  }

  // 4. 按得分降序排序
  scored.sort((a, b) => b.score - a.score);

  // 5. 取 topK
  const selected = scored.slice(0, topK);

  if (selected.length > 0) {
    console.log(
      `[retrieveCandidateTools] query="${query.slice(0, 40)}" | ` +
        `top-${selected.length}: ${selected.map((s) => `${s.contract.name}(${s.score.toFixed(1)})`).join(", ")}`
    );
  }

  return selected.map((s) => s.contract);
}

// ============================================================
// 打分逻辑
// ============================================================

function scoreTool(
  contract: CapabilityContract,
  lowerQuery: string,
  observations: Observation[]
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  // 1. query 命中加分
  const queryFields = [
    contract.name,
    contract.displayName,
    contract.description,
    contract.llm.whenToUse,
  ].filter(Boolean) as string[];

  for (const field of queryFields) {
    const matches = countKeywordMatches(lowerQuery, field.toLowerCase());
    if (matches > 0) {
      const points = matches * 2;
      score += points;
      reasons.push(`${field.slice(0, 20)} 命中 +${points}`);
    }
  }

  // 2. observation 文本命中加分
  if (observations.length > 0) {
    const obsText = buildObservationText(observations).toLowerCase();
    const obsFields = [contract.description, contract.llm.whenToUse].filter(
      Boolean
    ) as string[];

    for (const field of obsFields) {
      const matches = countKeywordMatches(obsText, field.toLowerCase());
      if (matches > 0) {
        const points = matches * 1;
        score += points;
        reasons.push(`obs 命中 ${field.slice(0, 20)} +${points}`);
      }
    }
  }

  // 3. avoidWhen 扣分
  if (contract.llm.avoidWhen) {
    for (const avoid of contract.llm.avoidWhen) {
      const matches = countKeywordMatches(lowerQuery, avoid.toLowerCase());
      if (matches > 0) {
        const points = matches * 3;
        score -= points;
        reasons.push(`avoidWhen 命中 -${points}`);
      }
    }
  }

  return { score, reasons };
}

// ============================================================
// 辅助函数
// ============================================================

/**
 * 计算 field 中有多少个词被包含在 text 中。
 * 简单策略：把 field 拆成 2+ 字符的词，统计在 text 中出现的数量。
 */
function countKeywordMatches(text: string, field: string): number {
  const stopWords = new Set(['的', '了', '是', '在', '和', '或', '某']);
  const queryKeywords = (text.match(/[一-鿿]{2,}/g) || []);
  let matches = 0;
  for (const kw of queryKeywords) {
    for (let i = 0; i <= kw.length - 2; i++) {
      const bigram = kw.slice(i, i + 2);
      if (!stopWords.has(bigram) && field.includes(bigram)) {
        matches++;
      }
    }
  }
  return matches;
}

function extractKeywords(text: string): string[] {
  const keywords: string[] = [];

  // 中文字符序列（连续 2+ 个中文字符）
  const chineseMatches = text.match(/[一-鿿]{2,}/g);
  if (chineseMatches) {
    keywords.push(...chineseMatches);
  }

  // 英文单词（3+ 字母）
  const englishMatches = text.match(/[a-zA-Z]{3,}/g);
  if (englishMatches) {
    keywords.push(...englishMatches.map((w) => w.toLowerCase()));
  }

  // 去重
  return [...new Set(keywords)];
}

function buildObservationText(observations: Observation[]): string {
  const parts: string[] = [];

  for (const obs of observations) {
    if (obs.result) {
      const result = obs.result as Record<string, unknown>;
      // 提取常见字段
      if (typeof result.message === "string") parts.push(result.message);
      if (typeof result.overview === "string") parts.push(result.overview);
      if (typeof result.description === "string") parts.push(result.description);
      if (Array.isArray(result.articles)) {
        for (const a of result.articles as Array<Record<string, unknown>>) {
          if (typeof a.title === "string") parts.push(a.title);
          if (typeof a.summary === "string") parts.push(a.summary);
        }
      }
    }
  }

  return parts.join(" ");
}

/**
 * 过滤掉已经调用过的工具+参数组合。
 * 与 runtimeState.hasUsedTool 配合使用。
 */
export function filterUsedTools(
  candidates: CapabilityContract[],
  usedToolNames: Set<string>
): CapabilityContract[] {
  return candidates.filter((c) => !usedToolNames.has(c.name));
}
