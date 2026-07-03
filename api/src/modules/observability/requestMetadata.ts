import crypto from "node:crypto";
import type { Request } from "express";

export interface RequestMetadata {
  requestId: string;
  method: string;
  path: string;
  userAgent?: string;
  ipHash?: string;
  ipMasked?: string;
  receivedAt: string;
}

export function extractRequestMetadata(req: Request, now = new Date()): RequestMetadata {
  const requestId = headerValue(req.headers["x-request-id"]) ?? crypto.randomUUID();
  const userAgent = headerValue(req.headers["user-agent"]);
  const rawIp = firstForwardedIp(req) ?? req.ip;

  return {
    requestId,
    method: req.method,
    path: req.originalUrl || req.path,
    ...(userAgent ? { userAgent } : {}),
    ...(rawIp ? { ipHash: hashIp(rawIp), ipMasked: maskIp(rawIp) } : {}),
    receivedAt: now.toISOString(),
  };
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function firstForwardedIp(req: Request): string | undefined {
  const forwarded = headerValue(req.headers["x-forwarded-for"]);
  return forwarded?.split(",")[0]?.trim();
}

function hashIp(ip: string): string {
  return crypto.createHash("sha256").update(ip).digest("hex");
}

function maskIp(ip: string): string {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    return ip.split(".").slice(0, 3).concat("0").join(".");
  }
  if (/^[0-9a-fA-F:]+$/.test(ip)) {
    return ip.replace(/(:[0-9a-fA-F]{0,4}){2}$/, ":0000:0000");
  }
  return "unknown";
}
