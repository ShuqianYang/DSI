import type { PromptSection } from "./types.js";

export interface ContextManager {
  buildContextSections(query: string): Promise<PromptSection[]>;
}

export const noopContextManager: ContextManager = {
  async buildContextSections() {
    return [];
  },
};

