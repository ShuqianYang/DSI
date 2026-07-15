
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

peak_hour_ranked AS (
    SELECT
        HOUR(event_time) AS hour_val,
        COUNT(*) AS peak_count,
        ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC, HOUR(event_time)) AS rn
    FROM alarm
    GROUP BY HOUR(event_time)
),

peak_hour AS (
    SELECT
        MAX(CASE WHEN rn = 1 THEN hour_val END) AS hour_val,
        MAX(CASE WHEN rn = 1 THEN peak_count END) AS peak_count
    FROM peak_hour_ranked
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
