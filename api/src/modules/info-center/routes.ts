import { Router } from "express";
import { asyncHandler } from "../../middleware/errorHandler.js";
import { listInfoCenter, exportInfoCenter } from "./controller.js";

const router = Router();

router.get("/", asyncHandler(listInfoCenter));
router.get("/export", asyncHandler(exportInfoCenter));

export default router;
