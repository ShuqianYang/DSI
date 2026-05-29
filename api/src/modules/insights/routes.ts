import { Router } from "express";
import { asyncHandler } from "../../middleware/errorHandler.js";
import {
  createInsight,
  listInsights,
  getInsight,
  updateInsight,
  deleteInsight,
} from "./controller.js";

const router = Router();

router.post("/", asyncHandler(createInsight));
router.get("/", asyncHandler(listInsights));
router.get("/:id", asyncHandler(getInsight));
router.patch("/:id", asyncHandler(updateInsight));
router.delete("/:id", asyncHandler(deleteInsight));

export default router;
