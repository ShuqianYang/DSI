import type { PromptSection } from "./types.js";

export interface SkillManager {
  getRelevantSkills(query: string): Promise<PromptSection[]>;
}

export const noopSkillManager: SkillManager = {
  async getRelevantSkills() {
    return [];
  },
};

