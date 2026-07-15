/**
 * HybridMemoryManager (P1-5, P1-6, P1-7) - Vector + keyword hybrid recall.
 *
 * Wraps an existing MemoryManager (typically SessionSummaryMemoryManager) and
 * augments recall with pgvector semantic search on episodic_memories and
 * task_conversation_snapshot tables. Applies exponential time decay and
 * hybrid scoring (vector × weight + keyword × weight + entity × weight).
 *
 * Gracefully degrades to the wrapped manager when embeddingClient is unavailable.
 */

import { sql } from "drizzle-orm";
import type { EmbeddingClient } from "./embeddingClient.js";
import type { MemoryDiagnostics, MemoryManager } from "./memoryManager.js";
import type { AgentLoopPrefetch, AgentLoopToolUseContext, PromptSection } from "./tools/_shared/types.js";
import type { AgentMessage } from "./tools/_shared/types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HybridMemoryDatabase {
  execute(query: unknown): Promise<{ rows: unknown[] }>;
}

export interface CreateHybridMemoryManagerInput {
  sessionMemoryManager: MemoryManager;
  db: HybridMemoryDatabase;
  embeddingClient?: EmbeddingClient;
  currentUserId: string | null;
  decayLambda: number;
  vectorWeight: number;
  keywordWeight: number;
  entityWeight: number;
  vectorTopK?: number;
  logger?: Pick<Console, "warn">;
}

interface VectorSearchResult {
  id: string;
  taskId: string | null;
  query: string;
  summary: string | null;
  finalResult: string | null;
  scene: string | null;
  relatedEntities: string[] | null;
  tags: string[] | null;
  importance: number | null;
  similarity: number;
  createdAt: Date;
  source: "episodic_memories" | "task_conversation_snapshot";
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createHybridMemoryManager(
  input: CreateHybridMemoryManagerInput
): MemoryManager {
  const logger = input.logger ?? console;
  const vectorTopK = input.vectorTopK ?? 10;

  // When embeddingClient is unavailable, degrade to the wrapped manager
  if (!input.embeddingClient) {
    return input.sessionMemoryManager;
  }

  const embeddingClient = input.embeddingClient;
  const sessionMemoryManager = input.sessionMemoryManager;

  return {
    ...sessionMemoryManager,

    startRelevantMemoryPrefetch(
      messages: readonly AgentMessage[],
      toolUseContext: AgentLoopToolUseContext
    ): AgentLoopPrefetch | undefined {
      const sessionPrefetch = sessionMemoryManager.startRelevantMemoryPrefetch(
        messages,
        toolUseContext
      );

      if (!input.currentUserId) {
        return sessionPrefetch;
      }

      const query = extractLastUserMessage(messages);
      if (!query) return sessionPrefetch;

      const vectorPromise = runVectorRecall({
        query,
        userId: input.currentUserId,
        embeddingClient,
        db: input.db,
        decayLambda: input.decayLambda,
        vectorWeight: input.vectorWeight,
        keywordWeight: input.keywordWeight,
        entityWeight: input.entityWeight,
        vectorTopK,
        logger,
      });

      // If session prefetch exists, merge results
      if (sessionPrefetch) {
        const mergedPrefetch: AgentLoopPrefetch = {
          settledAt: null,
          consumedOnIteration: -1,
          promise: Promise.all([sessionPrefetch.promise, vectorPromise])
            .then(([sessionSections, vectorSections]) => {
              return [...sessionSections, ...vectorSections];
            })
            .finally(() => {
              mergedPrefetch.settledAt = Date.now();
            }),
        };
        return mergedPrefetch;
      }

      // No session prefetch — return vector-only prefetch
      const vectorPrefetch: AgentLoopPrefetch = {
        settledAt: null,
        consumedOnIteration: -1,
        promise: vectorPromise.finally(() => {
          vectorPrefetch.settledAt = Date.now();
        }),
      };
      return vectorPrefetch;
    },
  };
}

// ---------------------------------------------------------------------------
// Vector recall
// ---------------------------------------------------------------------------

async function runVectorRecall(params: {
  query: string;
  userId: string;
  embeddingClient: EmbeddingClient;
  db: HybridMemoryDatabase;
  decayLambda: number;
  vectorWeight: number;
  keywordWeight: number;
  entityWeight: number;
  vectorTopK: number;
  logger: Pick<Console, "warn">;
}): Promise<PromptSection[]> {
  try {
    const queryEmbedding = await params.embeddingClient.embed(params.query);
    const queryVectorStr = formatVectorForPg(queryEmbedding);

    // Search episodic_memories
    const episodeResults = await searchEpisodicMemories(
      params.db,
      params.userId,
      queryVectorStr,
      params.vectorTopK
    );

    // Search task_conversation_snapshot (non-checkpoint only)
    const snapshotResults = await searchConversationSnapshots(
      params.db,
      params.userId,
      queryVectorStr,
      params.vectorTopK
    );

    const allResults = [...episodeResults, ...snapshotResults];

    // Compute hybrid scores
    const scored = allResults.map((result) => {
      const vectorSim = result.similarity;
      const keywordScore = calculateKeywordScore(params.query, buildSearchableText(result));
      const entityScore = calculateEntityScore(params.query, result.relatedEntities ?? []);
      const decay = calculateDecay(result.createdAt, params.decayLambda);

      const finalScore =
        (vectorSim * params.vectorWeight +
          keywordScore * params.keywordWeight +
          entityScore * params.entityWeight) *
        decay;

      return { result, finalScore };
    });

    // Sort by finalScore descending, take top-K
    scored.sort((a, b) => b.finalScore - a.finalScore);
    const topResults = scored.slice(0, params.vectorTopK);

    return topResults.map(({ result, finalScore }) =>
      formatVectorMemorySection(result, finalScore)
    );
  } catch (error) {
    params.logger.warn(
      "[HybridMemory] vector recall failed:",
      error instanceof Error ? error.message : String(error)
    );
    return [];
  }
}

async function searchEpisodicMemories(
  db: HybridMemoryDatabase,
  userId: string,
  queryVectorStr: string,
  limit: number
): Promise<VectorSearchResult[]> {
  const rows = (
    await db.execute(sql`
      SELECT
        id,
        task_id,
        user_query,
        final_result,
        scene,
        related_entities,
        tags,
        importance,
        1 - (embedding <=> ${queryVectorStr}::vector) AS similarity,
        created_at
      FROM episodic_memories
      WHERE user_id = ${userId}
        AND embedding IS NOT NULL
      ORDER BY embedding <=> ${queryVectorStr}::vector
      LIMIT ${limit}
    `)
  ).rows as EpisodicMemoryRow[];

  return rows.map((row) => ({
    id: String(row.id),
    taskId: row.task_id ?? null,
    query: row.user_query ?? "",
    summary: null,
    finalResult: row.final_result ?? null,
    scene: row.scene ?? null,
    relatedEntities: Array.isArray(row.related_entities) ? row.related_entities : [],
    tags: Array.isArray(row.tags) ? row.tags : [],
    importance: row.importance ?? 0.5,
    similarity: Number(row.similarity) || 0,
    createdAt: new Date(row.created_at),
    source: "episodic_memories" as const,
  }));
}

async function searchConversationSnapshots(
  db: HybridMemoryDatabase,
  userId: string,
  queryVectorStr: string,
  limit: number
): Promise<VectorSearchResult[]> {
  const rows = (
    await db.execute(sql`
      SELECT
        id,
        task_id,
        query,
        summary,
        final_answer,
        scenario,
        entities,
        1 - (embedding <=> ${queryVectorStr}::vector) AS similarity,
        created_at
      FROM task_conversation_snapshot
      WHERE user_id = ${userId}
        AND is_checkpoint = false
        AND embedding IS NOT NULL
      ORDER BY embedding <=> ${queryVectorStr}::vector
      LIMIT ${limit}
    `)
  ).rows as SnapshotRow[];

  return rows.map((row) => ({
    id: String(row.id),
    taskId: row.task_id ?? null,
    query: row.query ?? "",
    summary: row.summary ?? null,
    finalResult: row.final_answer ?? null,
    scene: row.scenario ?? null,
    relatedEntities: Array.isArray(row.entities) ? row.entities : [],
    tags: [],
    importance: 0.5,
    similarity: Number(row.similarity) || 0,
    createdAt: new Date(row.created_at),
    source: "task_conversation_snapshot" as const,
  }));
}

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------

function calculateDecay(createdAt: Date, lambda: number): number {
  const ageInDays = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
  return Math.exp(-lambda * Math.max(0, ageInDays));
}

function calculateKeywordScore(query: string, content: string): number {
  const terms = extractTerms(query);
  if (terms.length === 0) return 0;
  const contentLower = content.toLowerCase();
  const matches = terms.filter((term) => contentLower.includes(term));
  return matches.length / terms.length;
}

function calculateEntityScore(query: string, entities: string[]): number {
  if (entities.length === 0) return 0;
  const queryLower = query.toLowerCase();
  const matches = entities.filter((entity) =>
    queryLower.includes(entity.toLowerCase())
  );
  return matches.length / entities.length;
}

function extractTerms(text: string): string[] {
  // Simple term extraction: split on non-alphanumeric (handles CJK chars as single terms)
  const terms = text
    .toLowerCase()
    .split(/[\s,，。.!！?？;；:："'`()\-/\\]+/)
    .filter((t) => t.length >= 2);
  return [...new Set(terms)];
}

function buildSearchableText(result: VectorSearchResult): string {
  const parts = [
    result.query,
    result.summary ?? "",
    result.finalResult ?? "",
    result.scene ?? "",
    ...(result.tags ?? []),
  ];
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function formatVectorMemorySection(
  result: VectorSearchResult,
  score: number
): PromptSection {
  return {
    id: `memory.vector.${result.source}.${result.id}`,
    metadata: {
      memoryRecall: {
        query: result.query,
        ...(result.summary ? { summary: result.summary } : {}),
        ...(result.finalResult ? { finalResult: result.finalResult } : {}),
        score: Number(score.toFixed(4)),
        source: result.source,
      },
    },
    content: JSON.stringify(
      {
        source: result.source,
        taskId: result.taskId,
        query: result.query,
        scene: result.scene,
        summary: result.summary,
        finalResult: result.finalResult,
        relatedEntities: result.relatedEntities,
        tags: result.tags,
        importance: result.importance,
        hybridScore: Number(score.toFixed(4)),
        similarity: Number(result.similarity.toFixed(4)),
      },
      null,
      2
    ),
  };
}

function extractLastUserMessage(messages: readonly AgentMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "user") {
      return messages[i].content;
    }
  }
  return undefined;
}

function formatVectorForPg(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

// ---------------------------------------------------------------------------
// Row types (from raw SQL)
// ---------------------------------------------------------------------------

interface EpisodicMemoryRow {
  id: string;
  task_id: string | null;
  user_query: string;
  final_result: string | null;
  scene: string | null;
  related_entities: string[] | null;
  tags: string[] | null;
  importance: number | null;
  similarity: number | string;
  created_at: string | Date;
}

interface SnapshotRow {
  id: string;
  task_id: string | null;
  query: string;
  summary: string | null;
  final_answer: string;
  scenario: string | null;
  entities: string[] | null;
  similarity: number | string;
  created_at: string | Date;
}
