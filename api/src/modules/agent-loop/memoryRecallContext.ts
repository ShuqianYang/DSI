/**
 * MemoryRecallContext (P1-8) - 记忆去重上下文.
 *
 * Tracks which memory sections have already been surfaced to the LLM and
 * which tools have been recently called. Used to avoid repeatedly injecting
 * the same memory and to support tool-based deduplication.
 */

import type { PromptSection } from "./tools/_shared/types.js";

const MAX_SURFACED = 50;
const KEEP_RECENT_N = 30;

export class MemoryRecallContext {
  private readonly alreadySurfacedIds = new Set<string>();
  private readonly recentTools: string[] = [];
  private readonly maxSurfaced: number;
  private readonly keepRecentN: number;

  constructor(options?: { maxSurfaced?: number; keepRecentN?: number }) {
    this.maxSurfaced = options?.maxSurfaced ?? MAX_SURFACED;
    this.keepRecentN = options?.keepRecentN ?? KEEP_RECENT_N;
  }

  /** Mark section IDs as having been surfaced to the LLM. */
  markSurfaced(sectionIds: string[]): void {
    for (const id of sectionIds) {
      this.alreadySurfacedIds.add(id);
    }
    // Evict oldest entries when exceeding the cap
    if (this.alreadySurfacedIds.size > this.maxSurfaced) {
      const all = [...this.alreadySurfacedIds];
      const toKeep = all.slice(all.length - this.keepRecentN);
      this.alreadySurfacedIds.clear();
      for (const id of toKeep) {
        this.alreadySurfacedIds.add(id);
      }
    }
  }

  /** Check whether a section ID has already been surfaced. */
  isAlreadySurfaced(sectionId: string): boolean {
    return this.alreadySurfacedIds.has(sectionId);
  }

  /** Record a tool call for recent-tools tracking. */
  addRecentTool(toolName: string): void {
    this.recentTools.push(toolName);
    // Keep the list bounded
    if (this.recentTools.length > this.keepRecentN) {
      this.recentTools.splice(0, this.recentTools.length - this.keepRecentN);
    }
  }

  /** Get the list of recently called tools (oldest first). */
  getRecentTools(): string[] {
    return [...this.recentTools];
  }

  /** Filter out sections that have already been surfaced. */
  filterCandidates(sections: PromptSection[]): PromptSection[] {
    return sections.filter((section) => !this.alreadySurfacedIds.has(section.id));
  }

  /** Get the count of surfaced sections (for diagnostics). */
  get surfacedCount(): number {
    return this.alreadySurfacedIds.size;
  }
}
