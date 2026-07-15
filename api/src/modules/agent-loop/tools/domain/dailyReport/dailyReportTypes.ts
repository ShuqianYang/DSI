export type DailyReportType = "all" | "buckle" | "event";

export interface DailyReportInput {
  date: string;
  report_type: DailyReportType;
}

export interface ChartRenderDataOutput {
  chart_type: "bar" | "line" | "pie";
  title: string;
  chart_id: string;
  data: Record<string, unknown>[];
  config: {
    x_axis?: string;
    y_axis?: string;
    label_key?: string;
    value_key?: string;
    series_keys?: string[];
  };
}

export interface DailyReportOutput {
  date: string;
  report_type: DailyReportType;
  report_content: string;
  charts: ChartRenderDataOutput[];
  executionTime: number;
  source: string;
  generation: {
    status: "generated" | "degraded" | "not_required";
    modelUsed: boolean;
    error?: string;
  };
}

export interface DailyReportDataRow {
  total_alarms?: number | string;
  valid_intrusion?: number | string;
  handle_rate?: number | string;
  avg_handle_seconds?: number | string;
  sla_rate?: number | string;
  device_total?: number | string;
  online_count?: number | string;
  offline_count?: number | string;
  online_rate?: number | string;
  top1_name?: string | null;
  top1_count?: number | string;
  top2_name?: string | null;
  top2_count?: number | string;
  top3_name?: string | null;
  top3_count?: number | string;
  most_freq_device?: string | null;
  most_freq_count?: number | string;
  level1_count?: number | string;
  level1_ratio?: number | string;
  level1_avg_sec?: number | string;
  level2_count?: number | string;
  level2_ratio?: number | string;
  level2_avg_sec?: number | string;
  level3_count?: number | string;
  level3_ratio?: number | string;
  peak_start_hour?: number | string;
  peak_end_hour?: number | string;
  peak_count?: number | string;
  total_access?: number | string;
  person_times?: number | string;
  vehicle_times?: number | string;
  normal_entry?: number | string;
  normal_leave?: number | string;
  reject_entry?: number | string;
  black_count?: number | string;
  black_objects?: number | string;
  stranger_count?: number | string;
  stranger_objects?: number | string;
  white_count?: number | string;
  white_objects?: number | string;
  stay_cnt?: number | string;
  curr_stay_cnt?: number | string;
  top5_busy_buckle?: string;
}
