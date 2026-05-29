import { Router } from "express";
import { asyncHandler } from "../../middleware/errorHandler.js";
import {
  createSubscription,
  listSubscriptions,
  getSubscription,
  updateSubscription,
  deleteSubscription,
} from "./controller.js";

const router = Router();

router.post("/", asyncHandler(createSubscription));
router.get("/", asyncHandler(listSubscriptions));
router.get("/:id", asyncHandler(getSubscription));
router.patch("/:id", asyncHandler(updateSubscription));
router.delete("/:id", asyncHandler(deleteSubscription));

export default router;
