import { Router, type Request, type Response } from "express";
import { asyncHandler } from "../../../middleware/errorHandler.js";
import { runPhase0ToolLoop } from "./runPhase0ToolLoop.js";

const router = Router();

interface Phase0RequestBody {
  query: string;
}

/**
 * POST /agent/phase0/tool-loop
 * Phase 0 调试入口：直接运行 Agent tool-use loop（mock 决策）
 *
 * Body: { query: string }
 * Response: Phase0Result
 */
router.post(
  "/tool-loop",
  asyncHandler(async (req: Request, res: Response) => {
    const { query } = req.body as Phase0RequestBody;

    if (!query || typeof query !== "string") {
      res.status(400).json({ error: "Missing or invalid 'query' field" });
      return;
    }

    const result = await runPhase0ToolLoop(query);
    res.json(result);
  })
);

export default router;
