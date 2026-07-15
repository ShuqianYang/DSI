import { apiUrl, eventSourceUrl, getTask } from "@/lib/api";
import type { ReportType } from "@/components/border-defense/types";

const USER_ID = "border-defense-local-user";

async function postTask(path: string, body: Record<string, unknown>) {
  const response = await fetch(apiUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `HTTP ${response.status}`);
  }
  return response.json() as Promise<{ taskId: string; status: "pending" | "running" | "completed" | "failed"; reused?: boolean }>;
}

export function createQaTask(query: string, clientRequestId: string) {
  return postTask("/api/agent/intelligent-qa", { query, userId: USER_ID, clientRequestId });
}

export function createDailyReportTask(date: string, reportType: ReportType, clientRequestId: string) {
  return postTask("/api/agent/daily-report", {
    date,
    report_type: reportType,
    userId: USER_ID,
    clientRequestId,
  });
}

export function createTaskEventSource(taskId: string) {
  return new EventSource(eventSourceUrl(`/tasks/${taskId}/stream`));
}

export function abortBorderTask(taskId: string) {
  return fetch(apiUrl(`/tasks/${taskId}/abort`), { method: "POST" })
    .then(async (response) => {
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || `HTTP ${response.status}`);
      }
      return response.json() as Promise<{ aborted: boolean; taskId: string; message: string }>;
    });
}

export const getBorderTask = getTask;
export function dailyReportDownloadUrl(taskId: string) {
  return apiUrl(`/tasks/${taskId}/daily-report/download`);
}
