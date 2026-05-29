import { Router } from "express";
import { asyncHandler } from "../../middleware/errorHandler.js";
import {
  createRequirement,
  listRequirements,
  getRequirement,
  updateRequirement,
  deleteRequirement,
} from "./controller.js";

const router = Router();

router.post("/", asyncHandler(createRequirement));
router.get("/", asyncHandler(listRequirements));
router.get("/:id", asyncHandler(getRequirement));
router.patch("/:id", asyncHandler(updateRequirement));
router.delete("/:id", asyncHandler(deleteRequirement));

export default router;
