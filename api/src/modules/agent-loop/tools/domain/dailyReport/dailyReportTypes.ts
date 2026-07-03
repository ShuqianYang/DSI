export type DailyReportType = "all" | "buckle" | "event";

export interface DailyReportInput {
  query: string;
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

export const FIELD_LABELS: Record<DailyReportType, Record<string, string>> = {
  all: {
    total_alarms: "预警总数",
    valid_intrusion: "有效告警（入侵）",
    handle_rate: "处理完成率",
    avg_handle_seconds: "平均处理时长（秒）",
    sla_rate: "1000s处理达标率",
    device_total: "设备总量",
    online_count: "在线设备数",
    offline_count: "离线设备数",
    online_rate: "在线率",
    top1_name: "第一高发预警点位",
    top1_count: "第一高发预警点位次数",
    top2_name: "第二高发预警点位",
    top2_count: "第二高发预警点位次数",
    top3_name: "第三高发预警点位",
    top3_count: "第三高发预警点位次数",
    most_freq_device: "最频繁触发设备",
    most_freq_count: "最频繁触发设备次数",
    level1_count: "一级事件数量",
    level1_ratio: "一级事件占比",
    level1_avg_sec: "一级事件平均响应时长",
    level2_count: "二级事件数量",
    level2_ratio: "二级事件占比",
    level2_avg_sec: "二级事件平均响应时长",
    level3_count: "三级事件数量",
    level3_ratio: "三级事件占比",
    peak_start_hour: "高峰开始小时",
    peak_end_hour: "高峰结束小时",
    peak_count: "高峰触发次数",
    total_access: "总通行次数",
    person_times: "人员通行数",
    vehicle_times: "车辆通行数",
    normal_entry: "正常进入数",
    normal_leave: "正常离开数",
    reject_entry: "拒绝进入数",
    black_count: "黑名单进场次数",
    black_objects: "黑名单涉及人数或车数",
    stranger_count: "陌生人进场次数",
    stranger_objects: "陌生人涉及人数或车数",
    white_count: "白名单进场次数",
    white_objects: "白名单涉及人数或车数",
    stay_cnt: "滞留风险报警数",
    curr_stay_cnt: "当前仍滞留对象数",
    top5_busy_buckle: "卡口繁忙度Top5",
  },
  buckle: {
    total_access: "总通行次数",
    person_times: "人员通行数",
    vehicle_times: "车辆通行数",
    normal_entry: "正常进入数",
    normal_leave: "正常离开数",
    reject_entry: "拒绝进入数",
    black_count: "黑名单进场次数",
    black_objects: "黑名单涉及人数或车数",
    stranger_count: "陌生人进场次数",
    stranger_objects: "陌生人涉及人数或车数",
    white_count: "白名单进场次数",
    white_objects: "白名单涉及人数或车数",
    stay_cnt: "滞留风险报警数",
    curr_stay_cnt: "当前仍滞留对象数",
    top5_busy_buckle: "卡口繁忙度Top5",
  },
  event: {
    total_alarms: "预警总数",
    valid_intrusion: "有效告警（入侵）",
    handle_rate: "处理完成率",
    avg_handle_seconds: "平均处理时长（秒）",
    sla_rate: "1000s处理达标率",
    device_total: "设备总量",
    online_count: "在线设备数",
    offline_count: "离线设备数",
    online_rate: "在线率",
    top1_name: "第一高发预警点位",
    top1_count: "第一高发预警点位次数",
    top2_name: "第二高发预警点位",
    top2_count: "第二高发预警点位次数",
    top3_name: "第三高发预警点位",
    top3_count: "第三高发预警点位次数",
    most_freq_device: "最频繁触发设备",
    most_freq_count: "最频繁触发设备次数",
    level1_count: "一级事件数量",
    level1_ratio: "一级事件占比",
    level1_avg_sec: "一级事件平均响应时长",
    level2_count: "二级事件数量",
    level2_ratio: "二级事件占比",
    level2_avg_sec: "二级事件平均响应时长",
    level3_count: "三级事件数量",
    level3_ratio: "三级事件占比",
    peak_start_hour: "高峰开始小时",
    peak_end_hour: "高峰结束小时",
    peak_count: "高峰触发次数",
  },
};
