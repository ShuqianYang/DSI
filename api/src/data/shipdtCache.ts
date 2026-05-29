// ShipDT 内存 LRU 缓存

import type { ShipDTTileResult } from "./shipdtClient.js";

interface CacheEntry {
  value: ShipDTTileResult;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const MAX_ENTRIES = 500; // 最多缓存 500 个瓦片

function cleanupExpired() {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) {
      cache.delete(key);
    }
  }
}

function evictLRU() {
  if (cache.size < MAX_ENTRIES) return;

  // 找到最早过期的条目（如果有过期的）
  let oldestKey: string | null = null;
  let oldestTime = Infinity;

  for (const [key, entry] of cache) {
    if (entry.expiresAt < oldestTime) {
      oldestTime = entry.expiresAt;
      oldestKey = key;
    }
  }

  if (oldestKey) {
    cache.delete(oldestKey);
  }
}

export function getCache(key: string): ShipDTTileResult | undefined {
  cleanupExpired();
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

export function setCache(key: string, value: ShipDTTileResult, ttlMs: number): void {
  cleanupExpired();
  evictLRU();
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
}

export function getCacheStats(): {
  size: number;
  maxEntries: number;
  entries: Array<{ key: string; expiresIn: number; count: number }>;
} {
  cleanupExpired();
  const entries: Array<{ key: string; expiresIn: number; count: number }> = [];
  const now = Date.now();
  for (const [key, entry] of cache) {
    entries.push({
      key,
      expiresIn: Math.max(0, entry.expiresAt - now),
      count: entry.value.count,
    });
  }
  return {
    size: cache.size,
    maxEntries: MAX_ENTRIES,
    entries,
  };
}

export function clearCache(): void {
  cache.clear();
}
