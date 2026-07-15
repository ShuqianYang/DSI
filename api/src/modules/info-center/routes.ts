import { Router } from "express";
import { asyncHandler } from "../../middleware/errorHandler.js";
import { listTaskResults, exportTaskResults } from "./controller.js";

const router: Router = Router();

router.get("/", asyncHandler(listTaskResults));
router.get("/export", asyncHandler(exportTaskResults));

export default router;
