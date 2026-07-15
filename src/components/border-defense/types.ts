import type { ChartData, ThinkingStep } from "@/types/prd";

export type BorderDefenseMode = "qa" | "daily";
export type ReportType = "all" | "buckle" | "event";
export type TaskStatus = "pending" | "running" | "completed" | "failed";

export interface BorderTaskItem {
  id: string;
  title: string;
  type: BorderDefenseMode;
  date?: string;
  reportType?: ReportType;
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  unread?: boolean;
}

export interface LoopOutcome {
  outcome: "success" | "warning" | "failed";
  stoppedBy: "final_answer" | "max_turns" | "model_error" | "aborted";
  reason: string;
  turns: number;
  failedToolCount: number;
  logFilePath?: string;
}

export interface BorderMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  taskId?: string;
  steps?: ThinkingStep[];
  charts?: ChartData[];
  outcome?: LoopOutcome;
  expanded?: boolean;
}

export const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  all: "总体",
  buckle: "卡口/设备监控",
  event: "预警事态",
};
