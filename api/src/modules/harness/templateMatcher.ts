import {
  listRoutables,
  type RoutableDefinition,
} from "./matchRegistry.js";

// ============================================================
// 匹配结果类型
// ============================================================

export interface MatchCandidate {
  id: string;
  kind: "skill" | "template";
  confidence: number;
  matchedKeywords: string[];
  priority: number;
}

export type ConfidenceTier = "high" | "medium" | "low";

export interface TemplateMatchResult {
  /** 三档路由决策 */
  tier: ConfidenceTier;
  /** 最高置信度分数（0~1） */
  confidence: number;
  /** 所有候选，按置信度降序 */
  candidates: MatchCandidate[];
  /** 最佳候选 */
  topCandidate?: MatchCandidate;
  /** 决策原因说明 */
  reason: string;
}

// ============================================================
// 阈值配置（可调）
// ============================================================

const TIER_HIGH = 0.75;
const TIER_MEDIUM = 0.45;

/** 关键词分母上限：防止 keywords 过多的 skill 被过度稀释 */
const KEYWORD_CAP = 4;

/** 多关键词匹配奖励 */
const MULTI_MATCH_BONUS = 0.3;
const SINGLE_MATCH_BONUS = 0.1;

/** avoidWhen 惩罚系数 */
const AVOID_PENALTY_PER_WORD = 0.15;
const MAX_AVOID_PENALTY = 0.5;

// ============================================================
// 核心匹配函数
// ============================================================

/**
 * 对 user query 执行关键词匹配，返回三档置信度结果。
 *
 * 匹配逻辑：
 * 1. 遍历所有已注册的 skill / template
 * 2. 对每个 routable 的 keywords 做子串匹配（大小写不敏感）
 * 3. 计算置信度 = 匹配率 + 数量奖励 + priority 加成 - avoidWhen 惩罚
 * 4. 按分数排序，取最高分决定 tier
 *
 * 三档路由：
 * - high (>=0.75):   直接执行，零 LLM
 * - medium (0.45~0.75): 候选给 Agent 做最终决策（Agent 能看到上下文）
 * - low (<0.45):     走 Open Agent Loop，让 Agent 自由探索
 */
export function matchTemplates(query: string): TemplateMatchResult {
  const lowerQuery = query.toLowerCase();
  const routables = listRoutables();
  const candidates: MatchCandidate[] = [];

  for (const routable of routables) {
    const { matchedKeywords, matchCount } = matchKeywords(
      lowerQuery,
      routable.keywords
    );

    if (matchCount === 0) continue;

    const score = calculateConfidence(
      matchCount,
      routable.keywords.length,
      matchedKeywords,
      routable.priority ?? 0,
      lowerQuery,
      routable.avoidWhen
    );

    candidates.push({
      id: routable.id,
      kind: routable.kind,
      confidence: score,
      matchedKeywords,
      priority: routable.priority ?? 0,
    });
  }

  // 按置信度降序排序
  candidates.sort((a, b) => b.confidence - a.confidence);

  const topCandidate = candidates[0];
  const topConfidence = topCandidate?.confidence ?? 0;

  const tier = classifyTier(topConfidence);
  const reason = buildReason(topCandidate, tier, candidates.length);

  return {
    tier,
    confidence: topConfidence,
    candidates,
    topCandidate,
    reason,
  };
}

// ============================================================
// 分数计算
// ============================================================

/**
 * 计算单个 routable 的置信度分数。
 *
 * 公式：
 *   score = matchRate * 0.5 + countBonus + priorityBonus - avoidPenalty
 *
 * 其中：
 *   matchRate  = matchedCount / min(totalKeywords, KEYWORD_CAP)
 *   countBonus = matchedCount >= 2 ? MULTI_MATCH_BONUS : SINGLE_MATCH_BONUS
 *   priorityBonus = priority / 50
 */
function calculateConfidence(
  matchedCount: number,
  totalKeywords: number,
  _matchedKeywords: string[],
  priority: number,
  lowerQuery: string,
  avoidWhen?: string[]
): number {
  const denominator = Math.min(totalKeywords, KEYWORD_CAP);
  const matchRate = matchedCount / denominator;

  const countBonus =
    matchedCount >= 2 ? MULTI_MATCH_BONUS : SINGLE_MATCH_BONUS;

  const priorityBonus = priority / 50;

  const avoidPenalty = computeAvoidPenalty(lowerQuery, avoidWhen);

  let score = matchRate * 0.5 + countBonus + priorityBonus - avoidPenalty;

  return Math.max(0, Math.min(1.0, score));
}

// ============================================================
// 关键词匹配
// ============================================================

function matchKeywords(
  lowerQuery: string,
  keywords: string[]
): { matchedKeywords: string[]; matchCount: number } {
  const matchedKeywords: string[] = [];

  for (const kw of keywords) {
    if (lowerQuery.includes(kw.toLowerCase())) {
      matchedKeywords.push(kw);
    }
  }

  return { matchedKeywords, matchCount: matchedKeywords.length };
}

// ============================================================
// avoidWhen 惩罚
// ============================================================

/**
 * 如果 query 包含 avoidWhen 中的关键词，降低置信度。
 * 这防止了 skill 在明显不适合的场景被误命中。
 */
function computeAvoidPenalty(
  lowerQuery: string,
  avoidWhen?: string[]
): number {
  if (!avoidWhen || avoidWhen.length === 0) return 0;

  let penalty = 0;

  for (const phrase of avoidWhen) {
    const words = phrase
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 1);

    let matchedWords = 0;
    for (const word of words) {
      if (lowerQuery.includes(word)) {
        matchedWords++;
      }
    }

    if (matchedWords > 0) {
      penalty += AVOID_PENALTY_PER_WORD * matchedWords;
    }
  }

  return Math.min(MAX_AVOID_PENALTY, penalty);
}

// ============================================================
// 分档分类
// ============================================================

function classifyTier(confidence: number): ConfidenceTier {
  if (confidence >= TIER_HIGH) return "high";
  if (confidence >= TIER_MEDIUM) return "medium";
  return "low";
}

// ============================================================
// 原因构建
// ============================================================

function buildReason(
  topCandidate: MatchCandidate | undefined,
  tier: ConfidenceTier,
  candidateCount: number
): string {
  if (!topCandidate) {
    return "未匹配到任何 skill / template";
  }

  const tierLabel =
    tier === "high" ? "高置信度" : tier === "medium" ? "中置信度" : "低置信度";

  const matchedKws = topCandidate.matchedKeywords.join(", ");

  return `${tierLabel}命中 ${topCandidate.id}（置信度 ${topCandidate.confidence.toFixed(2)}，` +
    `匹配关键词: ${matchedKws}，` +
    `共 ${candidateCount} 个候选）`;
}
