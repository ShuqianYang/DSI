import { Router } from "express";
import { asyncHandler } from "../../middleware/errorHandler.js";
import {
  createJobTask,
  listJobTasks,
  getJobTask,
  updateJobTask,
  deleteJobTask,
} from "./controller.js";

const router = Router();

router.post("/", asyncHandler(createJobTask));
router.get("/", asyncHandler(listJobTasks));
router.get("/:id", asyncHandler(getJobTask));
router.patch("/:id", asyncHandler(updateJobTask));
router.delete("/:id", asyncHandler(deleteJobTask));

export default router;
