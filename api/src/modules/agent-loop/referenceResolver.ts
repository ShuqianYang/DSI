/**
 * 上下文指代替换模块 (Reference Resolver)
 *
 * 在召回/检索前，检测用户查询中的指代表达式（如"上一轮说的地方"），
 * 并将其替换为实际的指代对象。
 *
 * 不影响权重逻辑，纯粹是查询层面的文本替换。
 */

import { createTextGenerationClient } from "./model/clients/textGenerationClient.js";
import type { ModelMessage } from "./model/types.js";

// ---------------------------------------------------------------------------
// 指代模式检测 — 快速正则预筛，避免不必要的 LLM 调用
// ---------------------------------------------------------------------------

const REFERENTIAL_PATTERNS: RegExp[] = [
  /上一轮/,
  /刚才/,
  /前面[那这]?[轮次遍回个]/,
  /之前[那这]?[轮次遍回个]/,
  /上面[那这]?[轮次遍回个]/,
  /刚刚/,
  /那个(?:地方|位置|区域|船[舶只]?|飞机|航班|范围|坐标|点)/,
  /这个(?:地方|位置|区域|船[舶只]?|飞机|航班|范围|坐标|点)/,
  /你说的/,
  /提到的/,
  /聊到的/,
  /上面[说的提到聊]的/,
  /前面[说的提到聊]的/,
  /刚才[说的提到聊]的/,
  /之前[说的提到聊]的/,
  /上一[轮次遍回][说的提到聊]的/,
  /刚刚[说的提到聊]的/,
];

/**
 * 快速检测查询中是否含有指代表达式。
 * 用于避免对不含指代的查询进行不必要的 LLM 调用。
 */
export function hasReferentialPatterns(query: string): boolean {
  return REFERENTIAL_PATTERNS.some((pattern) => pattern.test(query));
}

// ---------------------------------------------------------------------------
// LLM 消解
// ---------------------------------------------------------------------------

const RESOLVER_TIMEOUT_MS = 15_000;

export interface ReferenceResolverModelClient {
  generateText(
    messages: ModelMessage[],
    options?: { temperature?: number; maxTokens?: number; signal?: AbortSignal }
  ): Promise<string>;
}

export interface ReferenceResolverDependencies {
  modelClient?: ReferenceResolverModelClient;
}

function buildResolvePrompt(input: {
  query: string;
  recentTaskContext: string;
}): string {
  return `你是一个上下文指代消解助手。给定前序对话的上下文和当前用户查询，将查询中的指代表达式替换为实际的指代对象。

前序对话上下文：
${input.recentTaskContext}

当前用户查询：
${input.query}

规则：
1. 识别"上一轮说的XX"、"刚才提到的"、"那个地方"等指代表达式
2. 从前序上下文中找到实际指代对象并替换到当前查询中
3. 如果没有需要消解的指代，原样返回当前查询
4. 只返回消解后的查询文本，不要添加任何解释或额外文字
5. 保留查询中非指代部分的原始表达`;
}

/**
 * 调用 LLM 消解指代。
 * 发送简单的 user message，不携带 tools，期望返回纯文本。
 */
async function resolveWithLLM(input: {
  query: string;
  recentTaskContext: string;
}, modelClient: ReferenceResolverModelClient): Promise<string> {
  const prompt = buildResolvePrompt(input);

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error(`Reference resolver timed out after ${RESOLVER_TIMEOUT_MS}ms`)),
    RESOLVER_TIMEOUT_MS
  );

  try {
    const content = await modelClient.generateText([{ role: "user", content: prompt }], {
      signal: controller.signal,
      temperature: 0,
      maxTokens: 500,
    });
    if (!content.trim()) throw new Error("Reference resolver returned empty response");
    return content.trim();
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

export interface ResolveQueryReferencesInput {
  /** 原始用户查询 */
  query: string;
  /** 前序任务摘要文本，格式如 "Q: 查询台海风场\nA: 已获取台海区域风场数据..." */
  recentTaskContext: string;
}

export interface ResolveQueryReferencesOutput {
  /** 消解后的查询（无指代时等于原始 query） */
  resolvedQuery: string;
  /** 是否实际进行了指代消解 */
  wasResolved: boolean;
}

/**
 * 主入口：检测并消解用户查询中的指代表达式。
 *
 * 流程：
 * 1. 正则预检测是否含指代表达式
 * 2. 若未命中 → 直接返回原始 query（零延迟）
 * 3. 若命中 → 调用 LLM 消解指代
 * 4. LLM 失败时降级返回原始 query
 */
export async function resolveQueryReferences(
  input: ResolveQueryReferencesInput,
  dependencies: ReferenceResolverDependencies = {}
): Promise<ResolveQueryReferencesOutput> {
  // 空上下文或空查询，无需消解
  if (!input.query.trim() || !input.recentTaskContext.trim()) {
    return { resolvedQuery: input.query, wasResolved: false };
  }

  // 快速正则预检 — 避免不必要的 LLM 调用
  if (!hasReferentialPatterns(input.query)) {
    return { resolvedQuery: input.query, wasResolved: false };
  }

  try {
    const modelClient = dependencies.modelClient ?? createTextGenerationClient("AGENT");
    const resolved = await resolveWithLLM({
      query: input.query,
      recentTaskContext: input.recentTaskContext,
    }, modelClient);

    // 如果 LLM 返回了与原查询不同的结果，且不为空
    if (resolved && resolved !== input.query) {
      console.log(
        `[ReferenceResolver] Resolved: "${input.query}" → "${resolved}"`
      );
      return { resolvedQuery: resolved, wasResolved: true };
    }

    return { resolvedQuery: input.query, wasResolved: false };
  } catch (error) {
    console.warn(
      "[ReferenceResolver] LLM resolution failed, falling back to original query:",
      error instanceof Error ? error.message : String(error)
    );
    return { resolvedQuery: input.query, wasResolved: false };
  }
}

// ---------------------------------------------------------------------------
// 前序任务上下文构建
// ---------------------------------------------------------------------------

export interface RecentTaskSummary {
  query: string;
  summary?: string | null;
}

/**
 * 将最近任务摘要列表拼接为 LLM 可用的上下文字符串。
 */
export function buildRecentTaskContext(tasks: RecentTaskSummary[]): string {
  if (tasks.length === 0) return "";

  return tasks
    .map((task, index) => {
      const parts: string[] = [`[第${index + 1}轮]`];
      parts.push(`用户查询: ${task.query}`);
      if (task.summary) {
        parts.push(`回答摘要: ${task.summary}`);
      }
      return parts.join("\n");
    })
    .join("\n\n");
}
