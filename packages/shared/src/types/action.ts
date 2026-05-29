import { z } from "zod";

export const ActionType = z.enum([
  "maritime",
  "intelligence",
  // "gis",
  "subscription",
  "requirement",
  "intelligent_qa",
  "daily_report",
  "satellite",
  "news",
  "fire-detector",
  // Scenario-mode capabilities (fine-grained)
  "region-mark",
  "weather-fetch",
  "oil-drift",
  "ais-fetch",
  "ais-match-suspects",
  "ais-suspect-ranking",
  "border-push",
  // Disaster assessment capabilities
  "earthquake-evaluation",
  "flood-evaluation",
]);
export type ActionType = z.infer<typeof ActionType>;

export const Action = z.object({
  id: z.string(),
  type: ActionType,
  name: z.string(),
  description: z.string(),
  params: z.record(z.string(), z.any()),
  dependsOn: z.array(z.string()).optional(),
});
export type Action = z.infer<typeof Action>;

export const ActionResult = z.object({
  success: z.boolean(),
  data: z.record(z.string(), z.any()).optional(),
  error: z.string().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});
export type ActionResult = z.infer<typeof ActionResult>;
