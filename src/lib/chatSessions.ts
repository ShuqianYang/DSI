'use client';

import type { ChatSession, ChatMessage, ScenarioId } from '@/types/prd';

const STORAGE_KEY = 'ty-chat-sessions';

export function getStorageKey(userId: string): string {
  return `${STORAGE_KEY}-${userId}`;
}

export function loadSessions(userId: string): ChatSession[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(getStorageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ChatSession[];
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn('[chatSessions] failed to load:', err);
    return [];
  }
}

export function saveSessions(userId: string, sessions: ChatSession[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(getStorageKey(userId), JSON.stringify(sessions));
  } catch (err) {
    console.warn('[chatSessions] failed to save:', err);
  }
}

export function getDefaultSessionId(scenarioId: ScenarioId): string {
  return `default-${scenarioId}`;
}

export function createDefaultSession(scenarioId: ScenarioId, title = '默认会话'): ChatSession {
  const now = Date.now();
  return {
    id: getDefaultSessionId(scenarioId),
    scenarioId,
    title,
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function ensureSession(
  sessions: ChatSession[],
  scenarioId: ScenarioId
): [ChatSession[], ChatSession] {
  const existing = sessions.find(
    (s) => s.scenarioId === scenarioId && s.id === getDefaultSessionId(scenarioId)
  );
  if (existing) return [sessions, existing];
  const created = createDefaultSession(scenarioId);
  return [[...sessions, created], created];
}

export function updateSessionMessages(
  sessions: ChatSession[],
  sessionId: string,
  updater: (messages: ChatMessage[]) => ChatMessage[]
): ChatSession[] {
  return sessions.map((s) =>
    s.id === sessionId
      ? { ...s, messages: updater(s.messages), updatedAt: Date.now() }
      : s
  );
}

export function findSessionIdByTaskId(sessions: ChatSession[], taskId: string): string | undefined {
  return sessions.find((s) => s.messages.some((m) => m.taskId === taskId))?.id;
}
