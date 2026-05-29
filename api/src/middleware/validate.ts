import type { Request, Response, NextFunction } from "express";
import { ZodSchema } from "zod";
import { asyncHandler } from "./errorHandler.js";

export function validateBody(schema: ZodSchema) {
  return asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    req.body = await schema.parseAsync(req.body);
    next();
  });
}

export function validateParams(schema: ZodSchema) {
  return asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    req.params = await schema.parseAsync(req.params);
    next();
  });
}
