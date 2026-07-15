
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
        SUM(CASE WHEN r.alarm_level = 2 THEN 1 ELSE 0 END) AS black_count,
        COUNT(DISTINCT CASE WHEN r.alarm_level = 2 THEN r.object_id END) AS black_objects,
        SUM(CASE WHEN r.alarm_level = 3 OR r.alarm_level IS NULL THEN 1 ELSE 0 END) AS stranger_count,
        COUNT(DISTINCT CASE WHEN r.alarm_level = 3 OR r.alarm_level IS NULL THEN r.object_id END) AS stranger_objects,
        SUM(CASE WHEN r.alarm_level = 1 THEN 1 ELSE 0 END) AS white_count,
        COUNT(DISTINCT CASE WHEN r.alarm_level = 1 THEN r.object_id END) AS white_objects
    FROM buckle r
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
