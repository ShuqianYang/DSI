import { Router, type Request, type Response, type Router as ExpressRouter } from "express";
import { resolveSatelliteSliceCallback } from "./tools/domain/satellite/satelliteCallbackStore.js";

const router: ExpressRouter = Router();

router.post("/agent/callback/slice", (req: Request, res: Response) => {
  const payload = req.body as Record<string, unknown>;
  const requirementId = typeof payload.requirementId === "string" ? payload.requirementId : undefined;

  if (!requirementId) {
    res.status(400).json({ state: false, message: "missing requirementId", code: 400 });
    return;
  }

  const resolved = resolveSatelliteSliceCallback(requirementId, payload);
  res.status(200).json({
    state: true,
    message: resolved ? "已接收" : "已接收（无等待方）",
    code: 200,
  });
});

export default router;
