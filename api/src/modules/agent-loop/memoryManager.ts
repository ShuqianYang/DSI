import type { PromptSection } from "./types.js";

export interface MemoryManager {
  recall(query: string): Promise<PromptSection[]>;
  remember?(query: string, finalAnswer: string): Promise<void>;
}

export const noopMemoryManager: MemoryManager = {
  async recall() {
    return [];
  },
};

