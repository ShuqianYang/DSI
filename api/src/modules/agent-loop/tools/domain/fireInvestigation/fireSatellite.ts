import { z } from "zod";
import type { ToolDefinition } from "../../_shared/types.js";
import { FIRE_RECT, OVERLAY_META } from "./mockData.js";

const InputSchema = z.strictObject({
  region: z.string().trim().min(1).default("Kensai"),
});

type FireSatelliteInput = z.infer<typeof InputSchema>;

export function buildFireSatelliteMockTool(): ToolDefinition {
  return {
    name: "FireSatelliteMock",
    aliases: ["fire-satellite"],
    description:
      "Deterministic mock satellite overlay fetch for the Kensai fire demo. Returns post-fire imagery aligned to the burned rectangle.",
    kind: "domain",
    inputSchema: InputSchema,
    isReadOnly: () => true,
    isDestructive: () => false,
    isConcurrencySafe: () => true,
    riskLevel: "low",
    async execute(input) {
      const parsed = input as FireSatelliteInput;

      return {
        summary: `已获取 ${parsed.region} 灾后卫星影像。`,
        region: parsed.region,
        imageCount: 1,
        gisData: {
          type: "image-overlay" as const,
          imageOverlays: [
            {
              id: "fire-post-image",
              url: OVERLAY_META.postFireImageUrl,
              rectangle: { ...FIRE_RECT },
              alpha: 1,
              tileWidth: 660,
              tileHeight: 590,
              outlineColor: "#FF6600",
            },
          ],
          cameraView: {
            type: "point" as const,
            lng: (FIRE_RECT.west + FIRE_RECT.east) / 2,
            lat: (FIRE_RECT.south + FIRE_RECT.north) / 2,
            altitude: 30_000,
          },
        },
        metadata: { capability: "satellite", mock: true },
      };
    },
  };
}
