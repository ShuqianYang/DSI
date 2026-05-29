import { Router } from "express";
import { asyncHandler } from "../../middleware/errorHandler.js";
import {
  createEvent,
  listEvents,
  getEvent,
  updateEvent,
  deleteEvent,
} from "./controller.js";

const router = Router();

router.post("/", asyncHandler(createEvent));
router.get("/", asyncHandler(listEvents));
router.get("/:id", asyncHandler(getEvent));
router.patch("/:id", asyncHandler(updateEvent));
router.delete("/:id", asyncHandler(deleteEvent));

export default router;
