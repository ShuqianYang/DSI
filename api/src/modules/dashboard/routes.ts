import { Router, type Router as ExpressRouter } from "express";
import { asyncHandler } from "../../middleware/errorHandler.js";
import * as controller from "./controller.js";

const router: ExpressRouter = Router();

router.get("/jobs", asyncHandler(controller.listJobs));
router.get("/events", asyncHandler(controller.listEvents));
router.get("/events/:id", asyncHandler(controller.getEventById));
router.patch("/events/:id", asyncHandler(controller.updateEventRead));
router.get("/subscriptions", asyncHandler(controller.listSubscriptions));
router.patch("/subscriptions/:id", asyncHandler(controller.updateSubscriptionStatus));
router.get("/requirements", asyncHandler(controller.listRequirements));
router.get("/insights", asyncHandler(controller.listInsights));
router.get("/insights/:id", asyncHandler(controller.getInsightById));
router.get("/ais/data", asyncHandler(controller.getAisData));
router.get("/ads/data", asyncHandler(controller.getAdsData));

export default router;
