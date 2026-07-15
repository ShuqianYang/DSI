import { z } from "zod";

export const DailyReportTypeSchema = z.enum(["all", "buckle", "event"]);

export const DailyReportDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "date must use YYYY-MM-DD format")
  .refine(isValidCalendarDate, "date must be a valid calendar date")
  .refine(isTodayOrEarlier, "date cannot be in the future");

export const DailyReportInputSchema = z.strictObject({
  date: DailyReportDateSchema.describe("Selected report date in YYYY-MM-DD format."),
  report_type: DailyReportTypeSchema.default("all").describe(
    "Selected report category: 'all', 'buckle', or 'event'."
  ),
});

function isValidCalendarDate(value: string): boolean {
  const [year, month, day] = value.split("-").map(Number);
  const candidate = new Date(year, month - 1, day);
  return candidate.getFullYear() === year
    && candidate.getMonth() === month - 1
    && candidate.getDate() === day;
}

function isTodayOrEarlier(value: string): boolean {
  const [year, month, day] = value.split("-").map(Number);
  const candidate = new Date(year, month - 1, day).getTime();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return candidate <= today;
}
