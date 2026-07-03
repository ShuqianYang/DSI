export const ALL_SQL = `
WITH
-- 告警记录（按时间范围和未删除过滤）
alarm AS (
    SELECT * 
    FROM alarm_event 
    WHERE event_time BETWEEN '{start_time}' AND '{end_time}' 
      AND is_deleted = 0
),

-- 卡口记录（按进入时间过滤，未删除）
buckle AS (
    SELECT * 
    FROM buckle_access_record 
    WHERE entry_time BETWEEN '{start_time}' AND '{end_time}' 
      AND is_deleted = 0
),

-- 1. 核心指标统计
core_stats AS (
    SELECT
        -- 预警总数 total_alarms
        COUNT(*) AS total_alarms,

        -- 一级告警 valid_intrusion：event_level = 1
        SUM(CASE WHEN event_level = '1' THEN 1 ELSE 0 END) AS valid_intrusion,
        
        -- 处理完成率 handle_rate（基于handle_time是否为空）
        ROUND(
            SUM(CASE WHEN handle_time IS NOT NULL THEN 1 ELSE 0 END) /
            NULLIF(COUNT(*), 0) * 100, 2
        ) AS handle_rate,

        -- 平均处理时长（秒）avg_handle_seconds
        ROUND(AVG(handle_seconds), 2) AS avg_handle_seconds,

        -- 1000s处理达标率 sla_rate（针对一级和二级事件）
        ROUND(
            SUM(CASE 
                WHEN event_level IN ('1','2') AND handle_seconds <= 1000 
                THEN 1 ELSE 0 END) / 
            NULLIF(SUM(CASE WHEN event_level IN ('1','2') THEN 1 ELSE 0 END), 0) * 100, 2
        ) AS sla_rate
    FROM alarm
),

-- 2. 设备状态统计
device_stats AS (
    SELECT
        -- 设备总数（delete_flag = 0）device_total
        COUNT(*) AS device_total,

        -- 在线设备数 online_count
        SUM(CASE WHEN online_status = 1 THEN 1 ELSE 0 END) AS online_count,

        -- 离线设备数 offline_count
        SUM(CASE WHEN online_status = 0 THEN 1 ELSE 0 END) AS offline_count,

        -- 在线率 online_rate
        ROUND(SUM(CASE WHEN online_status = 1 THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0) * 100, 2) AS online_rate
    FROM tb_device
    WHERE delete_flag = 0
),

-- 3. 高发预警点位（TOP3）
device_ranking AS (
    SELECT
        device_id,
        device_name,
        COUNT(*) AS trigger_count,
        ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC) AS rn
    FROM alarm
    GROUP BY device_id, device_name
    LIMIT 3
),

top3_devices AS (
    SELECT
        MAX(CASE WHEN rn = 1 THEN device_name END) AS top1_name,
        MAX(CASE WHEN rn = 1 THEN trigger_count END) AS top1_count,
        MAX(CASE WHEN rn = 2 THEN device_name END) AS top2_name,
        MAX(CASE WHEN rn = 2 THEN trigger_count END) AS top2_count,
        MAX(CASE WHEN rn = 3 THEN device_name END) AS top3_name,
        MAX(CASE WHEN rn = 3 THEN trigger_count END) AS top3_count
    FROM device_ranking
),

-- 4. 预警分类结构
alarm_category AS (
    SELECT
        event_level,
        COUNT(*) AS event_count,
        ROUND(COUNT(*) / NULLIF((SELECT COUNT(*) FROM alarm), 0) * 100, 2) AS ratio_percent,
        ROUND(AVG(handle_seconds), 2) AS avg_response_seconds
    FROM alarm
    GROUP BY event_level
),

category_pivot AS (
    SELECT
        MAX(CASE WHEN event_level = '1' THEN event_count END) AS level1_count,
        MAX(CASE WHEN event_level = '1' THEN ratio_percent END) AS level1_ratio,
        MAX(CASE WHEN event_level = '1' THEN avg_response_seconds END) AS level1_avg_sec,
        MAX(CASE WHEN event_level = '2' THEN event_count END) AS level2_count,
        MAX(CASE WHEN event_level = '2' THEN ratio_percent END) AS level2_ratio,
        MAX(CASE WHEN event_level = '2' THEN avg_response_seconds END) AS level2_avg_sec,
        MAX(CASE WHEN event_level = '3' THEN event_count END) AS level3_count,
        MAX(CASE WHEN event_level = '3' THEN ratio_percent END) AS level3_ratio
    FROM alarm_category
),

-- 5. 告警高发时段
peak_hour AS (
    SELECT
        HOUR(event_time) AS hour_val,
        COUNT(*) AS peak_count
    FROM alarm
    GROUP BY HOUR(event_time)
    ORDER BY peak_count DESC
    LIMIT 1
),

-- 6. 卡口流量概览
buckle_traffic AS (
    SELECT
        COUNT(*) AS total_access,
        SUM(CASE WHEN object_category = 1 THEN 1 ELSE 0 END) AS person_times,
        SUM(CASE WHEN object_category = 2 THEN 1 ELSE 0 END) AS vehicle_times,
        SUM(CASE WHEN match_result = 2 THEN 1 ELSE 0 END) AS normal_entry,
        SUM(CASE WHEN match_result = 5 THEN 1 ELSE 0 END) AS normal_leave,
        SUM(CASE WHEN match_result = 1 THEN 1 ELSE 0 END) AS reject_entry
    FROM buckle
),

-- 7. 往来对象风险研判
risk_assessment AS (
    SELECT
        SUM(CASE WHEN l.list_type = 2 THEN 1 ELSE 0 END) AS black_count,
        COUNT(DISTINCT CASE WHEN l.list_type = 2 THEN r.object_id END) AS black_objects,
        SUM(CASE WHEN l.list_type NOT IN (1, 2) OR l.list_type IS NULL THEN 1 ELSE 0 END) AS stranger_count,
        COUNT(DISTINCT CASE WHEN l.list_type NOT IN (1, 2) OR l.list_type IS NULL THEN r.object_id END) AS stranger_objects,
        SUM(CASE WHEN l.list_type = 1 THEN 1 ELSE 0 END) AS white_count,
        COUNT(DISTINCT CASE WHEN l.list_type = 1 THEN r.object_id END) AS white_objects
    FROM buckle r
    LEFT JOIN buckle_access_list l ON r.object_id = l.id
),

-- 8. 滞留风险监控
risk_monitoring AS (
    SELECT
        CASE 
            WHEN r.leave_time IS NULL
                 AND TIMESTAMPDIFF(SECOND, r.entry_time, NOW()) > t.permit_stay_duration
            THEN 1 
            ELSE 0 
        END AS is_stay,
        r.entry_time,
        r.leave_time
    FROM buckle r
    LEFT JOIN buckle_access_list l ON r.object_id = l.id  
    LEFT JOIN buckle_access_stay_time t 
        ON t.object_category = r.object_category
        AND t.object_type = l.object_type
),

risk_monitoring_sum AS (
    SELECT
        SUM(CASE WHEN is_stay = 1 THEN 1 ELSE 0 END) AS stay_cnt,
        SUM(CASE WHEN is_stay = 1 AND leave_time IS NULL THEN 1 ELSE 0 END) AS curr_stay_cnt
    FROM risk_monitoring
),

-- 9. 卡口繁忙度Top5
entry_buckle AS (
    SELECT
        entry_buckle_id AS buckle_id,
        entry_buckle_name AS buckle_name,
        COUNT(*) AS total_access_count
    FROM buckle
    WHERE IFNULL(entry_buckle_id, '') != ''
    GROUP BY entry_buckle_id, entry_buckle_name
),

leave_buckle AS (
    SELECT
        leave_buckle_id AS buckle_id,
        leave_buckle_name AS buckle_name,
        COUNT(*) AS total_access_count
    FROM buckle
    WHERE IFNULL(leave_buckle_id, '') != ''
    GROUP BY leave_buckle_id, leave_buckle_name
),

top5_busy_buckle AS (
    SELECT
        t.buckle_id,
        t.buckle_name,
        SUM(t.total_access_count) AS total_access_count
    FROM (
        SELECT * FROM entry_buckle
        UNION ALL
        SELECT * FROM leave_buckle
    ) t
    GROUP BY t.buckle_id, t.buckle_name
    ORDER BY total_access_count DESC
    LIMIT 5
),

top5_busy_buckle_json AS (
    SELECT 
        IFNULL(
            JSON_ARRAYAGG(
                JSON_OBJECT(
                    'buckle_id', buckle_id,
                    'buckle_name', buckle_name,
                    'total_access_count', total_access_count
                )
            ),
            '[]'
        ) AS json_content
    FROM top5_busy_buckle
)

SELECT
    c.total_alarms,
    c.valid_intrusion,
    c.handle_rate,
    c.avg_handle_seconds,
    c.sla_rate,
    d.device_total,
    d.online_count,
    d.offline_count,
    d.online_rate,
    t.top1_name, t.top1_count,
    t.top2_name, t.top2_count,
    t.top3_name, t.top3_count,
    t.top1_name AS most_freq_device,
    t.top1_count AS most_freq_count,
    p.level1_count, p.level1_ratio, p.level1_avg_sec,
    p.level2_count, p.level2_ratio, p.level2_avg_sec,
    p.level3_count, p.level3_ratio,
    h.hour_val AS peak_start_hour,
    h.hour_val + 1 AS peak_end_hour,
    h.peak_count,
    b.total_access,
    b.person_times,
    b.vehicle_times,
    b.normal_entry,
    b.normal_leave,
    b.reject_entry,
    IFNULL(r.black_count, 0) AS black_count,
    IFNULL(r.black_objects, 0) AS black_objects,
    IFNULL(r.stranger_count, 0) AS stranger_count,
    IFNULL(r.stranger_objects, 0) AS stranger_objects,
    IFNULL(r.white_count, 0) AS white_count,
    IFNULL(r.white_objects, 0) AS white_objects,
    m.stay_cnt,
    m.curr_stay_cnt,
    t5.json_content AS top5_busy_buckle
FROM core_stats c
CROSS JOIN device_stats d
CROSS JOIN top3_devices t
CROSS JOIN category_pivot p
CROSS JOIN peak_hour h
CROSS JOIN buckle_traffic b
CROSS JOIN risk_assessment r
CROSS JOIN risk_monitoring_sum m
CROSS JOIN top5_busy_buckle_json t5;
`;

export const BUCKLE_SQL = `
WITH
buckle AS (
    SELECT * 
    FROM buckle_access_record 
    WHERE entry_time BETWEEN '{start_time}' AND '{end_time}' 
      AND is_deleted = 0
),

buckle_traffic AS (
    SELECT
        COUNT(*) AS total_access,
        SUM(CASE WHEN object_category = 1 THEN 1 ELSE 0 END) AS person_times,
        SUM(CASE WHEN object_category = 2 THEN 1 ELSE 0 END) AS vehicle_times,
        SUM(CASE WHEN match_result = 2 THEN 1 ELSE 0 END) AS normal_entry,
        SUM(CASE WHEN match_result = 5 THEN 1 ELSE 0 END) AS normal_leave,
        SUM(CASE WHEN match_result = 1 THEN 1 ELSE 0 END) AS reject_entry
    FROM buckle
),

risk_assessment AS (
    SELECT
        SUM(CASE WHEN l.list_type = 2 THEN 1 ELSE 0 END) AS black_count,
        COUNT(DISTINCT CASE WHEN l.list_type = 2 THEN r.object_id END) AS black_objects,
        SUM(CASE WHEN l.list_type NOT IN (1, 2) OR l.list_type IS NULL THEN 1 ELSE 0 END) AS stranger_count,
        COUNT(DISTINCT CASE WHEN l.list_type NOT IN (1, 2) OR l.list_type IS NULL THEN r.object_id END) AS stranger_objects,
        SUM(CASE WHEN l.list_type = 1 THEN 1 ELSE 0 END) AS white_count,
        COUNT(DISTINCT CASE WHEN l.list_type = 1 THEN r.object_id END) AS white_objects
    FROM buckle r
    LEFT JOIN buckle_access_list l ON r.object_id = l.id
),

risk_monitoring AS (
    SELECT
        CASE 
            WHEN r.leave_time IS NULL
                 AND TIMESTAMPDIFF(SECOND, r.entry_time, NOW()) > t.permit_stay_duration
            THEN 1 
            ELSE 0 
        END AS is_stay,
        r.entry_time,
        r.leave_time
    FROM buckle r
    LEFT JOIN buckle_access_list l ON r.object_id = l.id  
    LEFT JOIN buckle_access_stay_time t 
        ON t.object_category = r.object_category
        AND t.object_type = l.object_type
),

risk_monitoring_sum AS (
    SELECT
        SUM(CASE WHEN is_stay = 1 THEN 1 ELSE 0 END) AS stay_cnt,
        SUM(CASE WHEN is_stay = 1 AND leave_time IS NULL THEN 1 ELSE 0 END) AS curr_stay_cnt
    FROM risk_monitoring
),

entry_buckle AS (
    SELECT
        entry_buckle_id AS buckle_id,
        entry_buckle_name AS buckle_name,
        COUNT(*) AS total_access_count
    FROM buckle
    WHERE IFNULL(entry_buckle_id, '') != ''
    GROUP BY entry_buckle_id, entry_buckle_name
),

leave_buckle AS (
    SELECT
        leave_buckle_id AS buckle_id,
        leave_buckle_name AS buckle_name,
        COUNT(*) AS total_access_count
    FROM buckle
    WHERE IFNULL(leave_buckle_id, '') != ''
    GROUP BY leave_buckle_id, leave_buckle_name
),

top5_busy_buckle AS (
    SELECT
        t.buckle_id,
        t.buckle_name,
        SUM(t.total_access_count) AS total_access_count
    FROM (
        SELECT * FROM entry_buckle
        UNION ALL
        SELECT * FROM leave_buckle
    ) t
    GROUP BY t.buckle_id, t.buckle_name
    ORDER BY total_access_count DESC
    LIMIT 5
),

top5_busy_buckle_json AS (
    SELECT 
        IFNULL(
            JSON_ARRAYAGG(
                JSON_OBJECT(
                    'buckle_id', buckle_id,
                    'buckle_name', buckle_name,
                    'total_access_count', total_access_count
                )
            ),
            '[]'
        ) AS json_content
    FROM top5_busy_buckle
)

SELECT
    b.total_access,
    b.person_times,
    b.vehicle_times,
    b.normal_entry,
    b.normal_leave,
    b.reject_entry,
    IFNULL(r.black_count, 0) AS black_count,
    IFNULL(r.black_objects, 0) AS black_objects,
    IFNULL(r.stranger_count, 0) AS stranger_count,
    IFNULL(r.stranger_objects, 0) AS stranger_objects,
    IFNULL(r.white_count, 0) AS white_count,
    IFNULL(r.white_objects, 0) AS white_objects,
    m.stay_cnt,
    m.curr_stay_cnt,
    t5.json_content AS top5_busy_buckle
FROM buckle_traffic b
CROSS JOIN risk_assessment r
CROSS JOIN risk_monitoring_sum m
CROSS JOIN top5_busy_buckle_json t5;
`;

export const EVENT_SQL = `
WITH
alarm AS (
    SELECT * 
    FROM alarm_event 
    WHERE event_time BETWEEN '{start_time}' AND '{end_time}' 
      AND is_deleted = 0
),

core_stats AS (
    SELECT
        COUNT(*) AS total_alarms,
        SUM(CASE WHEN event_level = '1' THEN 1 ELSE 0 END) AS valid_intrusion,
        ROUND(
            SUM(CASE WHEN handle_time IS NOT NULL THEN 1 ELSE 0 END) /
            NULLIF(COUNT(*), 0) * 100, 2
        ) AS handle_rate,
        ROUND(AVG(handle_seconds), 2) AS avg_handle_seconds,
        ROUND(
            SUM(CASE 
                WHEN event_level IN ('1','2') AND handle_seconds <= 1000 
                THEN 1 ELSE 0 END) / 
            NULLIF(SUM(CASE WHEN event_level IN ('1','2') THEN 1 ELSE 0 END), 0) * 100, 2
        ) AS sla_rate
    FROM alarm
),

device_stats AS (
    SELECT
        COUNT(*) AS device_total,
        SUM(CASE WHEN online_status = 1 THEN 1 ELSE 0 END) AS online_count,
        SUM(CASE WHEN online_status = 0 THEN 1 ELSE 0 END) AS offline_count,
        ROUND(SUM(CASE WHEN online_status = 1 THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0) * 100, 2) AS online_rate
    FROM tb_device
    WHERE delete_flag = 0
),

device_ranking AS (
    SELECT
        device_id,
        device_name,
        COUNT(*) AS trigger_count,
        ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC) AS rn
    FROM alarm
    GROUP BY device_id, device_name
    LIMIT 3
),

top3_devices AS (
    SELECT
        MAX(CASE WHEN rn = 1 THEN device_name END) AS top1_name,
        MAX(CASE WHEN rn = 1 THEN trigger_count END) AS top1_count,
        MAX(CASE WHEN rn = 2 THEN device_name END) AS top2_name,
        MAX(CASE WHEN rn = 2 THEN trigger_count END) AS top2_count,
        MAX(CASE WHEN rn = 3 THEN device_name END) AS top3_name,
        MAX(CASE WHEN rn = 3 THEN trigger_count END) AS top3_count
    FROM device_ranking
),

alarm_category AS (
    SELECT
        event_level,
        COUNT(*) AS event_count,
        ROUND(COUNT(*) / NULLIF((SELECT COUNT(*) FROM alarm), 0) * 100, 2) AS ratio_percent,
        ROUND(AVG(handle_seconds), 2) AS avg_response_seconds
    FROM alarm
    GROUP BY event_level
),

category_pivot AS (
    SELECT
        MAX(CASE WHEN event_level = '1' THEN event_count END) AS level1_count,
        MAX(CASE WHEN event_level = '1' THEN ratio_percent END) AS level1_ratio,
        MAX(CASE WHEN event_level = '1' THEN avg_response_seconds END) AS level1_avg_sec,
        MAX(CASE WHEN event_level = '2' THEN event_count END) AS level2_count,
        MAX(CASE WHEN event_level = '2' THEN ratio_percent END) AS level2_ratio,
        MAX(CASE WHEN event_level = '2' THEN avg_response_seconds END) AS level2_avg_sec,
        MAX(CASE WHEN event_level = '3' THEN event_count END) AS level3_count,
        MAX(CASE WHEN event_level = '3' THEN ratio_percent END) AS level3_ratio
    FROM alarm_category
),

peak_hour AS (
    SELECT
        HOUR(event_time) AS hour_val,
        COUNT(*) AS peak_count
    FROM alarm
    GROUP BY HOUR(event_time)
    ORDER BY peak_count DESC
    LIMIT 1
)

SELECT
    c.total_alarms,
    c.valid_intrusion,
    c.handle_rate,
    c.avg_handle_seconds,
    c.sla_rate,
    d.device_total,
    d.online_count,
    d.offline_count,
    d.online_rate,
    t.top1_name, t.top1_count,
    t.top2_name, t.top2_count,
    t.top3_name, t.top3_count,
    t.top1_name AS most_freq_device,
    t.top1_count AS most_freq_count,
    p.level1_count, p.level1_ratio, p.level1_avg_sec,
    p.level2_count, p.level2_ratio, p.level2_avg_sec,
    p.level3_count, p.level3_ratio,
    h.hour_val AS peak_start_hour,
    h.hour_val + 1 AS peak_end_hour,
    h.peak_count
FROM core_stats c
CROSS JOIN device_stats d
CROSS JOIN top3_devices t
CROSS JOIN category_pivot p
CROSS JOIN peak_hour h;
`;

export type DailyReportType = "all" | "buckle" | "event";

export function buildDailyReportSql(reportType: DailyReportType, startTime: string, endTime: string): string {
  const template =
    reportType === "buckle" ? BUCKLE_SQL :
    reportType === "event" ? EVENT_SQL :
    ALL_SQL;

  return template
    .replace(/\{start_time\}/g, startTime)
    .replace(/\{end_time\}/g, endTime);
}
