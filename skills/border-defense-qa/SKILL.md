---
name: border-defense-qa
description: Use when the user asks about border defense data, including alarm events, warning levels, checkpoint access records, devices, departments, patrol records, or statistical analysis of these data.
argument-hint: "[user border defense query in Chinese]"
allowed-tools: Read, MysqlQuerySchema, MysqlQuery
---

# Border Defense QA

Use this skill to answer natural-language questions about border defense data stored in the MySQL `xjzhdd_bj` database. The skill translates the user's question into a read-only MySQL query, executes it, and returns a Markdown answer.

## Required input

Pass the user's original query as `$ARGUMENTS`.

The query should be about one of these topics:

- Alarm/warning events (`alarm_event`)
- Checkpoint access records (`buckle_access_record`, `buckle_access_list`, `buckle_info`)
- Devices/sensors (`tb_device`)
- Departments (`sys_dept`)
- Patrol records (`make_rounds_record`)
- Statistical analysis, trends, rankings, or counts of the above

## Special responses (no tools)

### Self-introduction

If the user asks "你是谁", "你能做什么", "介绍一下你自己", or similar, do **not** call any tools. Reply in Chinese:

> 您好，我是边防智能问答助手，专注于边防数据的智能分析与问答。我可以帮您：
> 1. **数据查询**：查询预警事件、设备状态、人员/车辆通行记录、卡口往来等信息；
> 2. **统计分析**：对边防数据进行多维度统计，如预警分级统计、设备在线率分析、通行流量统计、处理时效分析等；
> 3. **趋势分析**：分析特定时间段内的数据变化趋势，识别异常时段和高风险区域；
> 4. **可视化展示**：根据查询结果自动生成柱状图、折线图、饼图等图表，辅助分析决策；
> 5. **明细查询**：查看预警事件、设备、卡口、部门等详细信息。
> 请直接告诉我您想了解哪些边防数据，我会为您查询并分析。

### Irrelevant questions

If the query is unrelated to border defense data (weather, news, stocks, general knowledge, coding, food recommendations, etc.), do **not** call any tools. Politely refuse in Chinese and suggest a valid example question.

## Database connection

Use the configured MySQL alias `border-defense`. The tool reads from `BORDER_DEFENSE_DB_HOST`, `BORDER_DEFENSE_DB_PORT`, `BORDER_DEFENSE_DB_USER`, `BORDER_DEFENSE_DB_PASSWORD`, and `BORDER_DEFENSE_DB_NAME`.

## Current date awareness

The current system date is part of the task context. When the user does not specify a year/month, default to the current month. Interpret time words as follows:

- "今天" = from 00:00:00 today to now
- "本周" = current week (Monday to today)
- "上周" = previous Monday to previous Sunday
- "最近7天" = today minus 7 days to today
- "最近24小时" = now minus 1 day to now
- "本月" / "本月至今" = first day of current month to now

## Core tables

Use `MysqlQuerySchema` when you are unsure about exact column names or types.

### `alarm_event`

Warning/alarm events.

| Column | Type | Meaning |
|--------|------|---------|
| `event_id` | varchar(64) | Primary key |
| `warning_classification_name` | varchar(64) | Event type name |
| `event_level_name` | varchar(32) | Warning level name |
| `event_time` | datetime | Event timestamp |
| `device_id` | varchar(64) | Device ID (FK to `tb_device.dev_id`) |
| `device_name` | varchar(256) | Device name |
| `longitude` | decimal(11,8) | Longitude |
| `latitude` | decimal(10,8) | Latitude |
| `owner_dept_id` | varchar(255) | Owning department ID (FK to `sys_dept.dept_id`) |
| `owner_dept_name` | varchar(256) | Owning department name |
| `handle_result` | tinyint | Handling result (1=false alarm, 2=intrusion, 3=test alarm, ...) |
| `handle_user_name` | varchar(128) | Handler name |
| `handle_time` | datetime | Handling time |
| `handle_seconds` | int | Handling duration in seconds |
| `dispose_status` | tinyint | Disposal status (0=pending, 1=in progress, 2=done) |
| `is_deleted` | tinyint | Soft delete flag (0=active, 1=deleted) |
| `is_mock_data` | tinyint | Mock flag (0=mock, 1=real) |

### `buckle_access_record`

Checkpoint access logs.

| Column | Type | Meaning |
|--------|------|---------|
| `id` | varchar(64) | Primary key |
| `object_id` | varchar(64) | Person/vehicle ID (FK to `buckle_access_list.id`) |
| `object_category` | tinyint | 1=person, 2=vehicle |
| `entry_buckle_id` | varchar(64) | Entry checkpoint ID (FK to `buckle_info.id`) |
| `entry_buckle_name` | varchar(128) | Entry checkpoint name |
| `entry_time` | datetime | Entry time |
| `leave_buckle_id` | varchar(64) | Exit checkpoint ID (FK to `buckle_info.id`) |
| `leave_buckle_name` | varchar(128) | Exit checkpoint name |
| `leave_time` | datetime | Exit time |
| `alarm_level` | tinyint | 1=white list, 2=black list, 3=stranger |
| `match_result` | tinyint | Match result code |
| `alarm_time` | datetime | Overstay alert time |
| `is_deleted` | tinyint | Soft delete flag |
| `is_mock_data` | tinyint | Mock flag |

### `buckle_access_list`

Person/vehicle registry.

| Column | Type | Meaning |
|--------|------|---------|
| `id` | varchar(64) | Primary key |
| `object_name` | varchar(64) | Person/vehicle name |
| `object_category` | tinyint | 1=person, 2=vehicle |
| `object_type` | tinyint | 1=staff, 2=herdsman, 3=visitor, 4=passenger vehicle, 5=private vehicle, 6=enterprise vehicle, 7=state vehicle |
| `license_number` | varchar(32) | License plate (for vehicles) |
| `list_type` | tinyint | 1=white list, 2=black list, 3=stranger |
| `is_deleted` | tinyint | Soft delete flag |

### `buckle_info`

Checkpoint metadata.

| Column | Type | Meaning |
|--------|------|---------|
| `id` | varchar(64) | Primary key |
| `buckle_code` | varchar(64) | Checkpoint code |
| `buckle_name` | varchar(128) | Checkpoint name |
| `dept_id` | varchar(64) | Department ID (FK to `sys_dept.dept_id`) |
| `longitude` | varchar(255) | Longitude |
| `latitude` | varchar(255) | Latitude |

### `buckle_access_stay_time`

Overstay duration configuration.

| Column | Type | Meaning |
|--------|------|---------|
| `object_category` | tinyint | 1=person, 2=vehicle |
| `object_type` | tinyint | Same values as `buckle_access_list.object_type` |
| `permit_stay_duration` | int | Allowed stay duration in seconds |

### `sys_dept`

Department hierarchy.

| Column | Type | Meaning |
|--------|------|---------|
| `dept_id` | varchar(64) | Primary key |
| `parent_id` | varchar(64) | Parent department ID |
| `dept_name` | varchar(64) | Department name |
| `dept_level` | int | Organization level |
| `status` | char(1) | 0=active, 1=disabled |
| `longitude` | varchar(255) | Longitude |
| `latitude` | varchar(255) | Latitude |

### `tb_device`

Device/sensor inventory.

| Column | Type | Meaning |
|--------|------|---------|
| `dev_id` | varchar(255) | Primary key |
| `dev_index_code` | varchar(255) | Device resource code |
| `dev_name` | varchar(256) | Device name |
| `dev_category` | varchar(256) | Device category |
| `dev_type_code` | varchar(256) | Device type code |
| `device_shape_type` | varchar(255) | Device shape/type |
| `online_status` | int | 0=offline, 1=online |
| `manufacturer` | varchar(1024) | Manufacturer |
| `longitude` | varchar(32) | Longitude |
| `latitude` | varchar(32) | Latitude |
| `install_place` | varchar(256) | Install location |

### `make_rounds_record`

Patrol records.

| Column | Type | Meaning |
|--------|------|---------|
| `id` | varchar(64) | Primary key |
| `clock_in_time` | datetime | Patrol timestamp |
| `user_name` | varchar(64) | Patroller name |
| `dept_id` | varchar(64) | Department ID |
| `longitude` | varchar(255) | Longitude |
| `latitude` | varchar(255) | Latitude |

## Workflow

1. Parse the user's question and identify:
   - Entity type (alarm, checkpoint, device, department, patrol)
   - Time range (default to current month if not specified)
   - Aggregation intent (count, group, ranking, trend)
   - Filtering intent (department, level, status)

2. If you are unsure about column names, call `MysqlQuerySchema` first:

   ```json
   {"database":"border-defense","table":"alarm_event"}
   ```

3. Generate a single read-only `SELECT` SQL statement.

4. Call `MysqlQuery` with the SQL:

   ```json
   {"database":"border-defense","sql":"SELECT event_level_name, COUNT(*) AS cnt FROM alarm_event WHERE event_time >= '2026-06-01' AND is_deleted = 0 GROUP BY event_level_name"}
   ```

5. Summarize the result in Markdown. Include a brief data table when helpful.

## SQL rules

- Only `SELECT` or `WITH` statements are allowed. Any DML/DDL request is rejected by `MysqlQuery`.
- Always filter out logically deleted rows (`is_deleted = 0`) unless the user explicitly asks for deleted data.
- Prefer `event_time`, `entry_time`, `leave_time`, `rounds_time` for time filtering. Default to the current month when the user does not specify a time range.
- Use `event_level_name` instead of numeric `event_level` for grouping/labeling alarm levels.
- "处理" refers to `handle_xxx` fields (e.g. `handle_result`, `handle_time`, `handle_seconds`).
- "处置" refers to `dispose_xxx` fields (e.g. `dispose_status`, `dispose_time`). Do not mix them.
- Join `sys_dept` on `dept_id` when the user asks by department name.
- Join `tb_device` on `dev_id`/`device_id` when the user asks by device name or type.
- Do not invent table names or column names. Use `MysqlQuerySchema` to confirm.
- Do not assume military activity, intrusion, or collision risk from location data alone.

## Example queries

### Count alarms by level this month

```sql
SELECT event_level_name, COUNT(*) AS cnt
FROM alarm_event
WHERE event_time >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
  AND is_deleted = 0
GROUP BY event_level_name;
```

### Top 5 devices with most alarms this month

```sql
SELECT device_id, device_name, COUNT(event_id) AS alarm_count
FROM alarm_event
WHERE DATE_FORMAT(event_time, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m')
  AND is_deleted = 0
GROUP BY device_id, device_name
ORDER BY alarm_count DESC
LIMIT 5;
```

### Checkpoint entries today by person/vehicle

```sql
SELECT
  SUM(CASE WHEN object_category = 1 THEN 1 ELSE 0 END) AS person_count,
  SUM(CASE WHEN object_category = 2 THEN 1 ELSE 0 END) AS vehicle_count
FROM buckle_access_record
WHERE entry_time >= CURDATE()
  AND entry_time < DATE_ADD(CURDATE(), INTERVAL 1 DAY)
  AND is_deleted = 0;
```

### Blacklist checkpoint alerts this week

```sql
SELECT r.entry_time, l.object_name, r.license_number, r.entry_buckle_name
FROM buckle_access_record r
INNER JOIN buckle_access_list l ON r.object_id = l.id
WHERE l.list_type = 2
  AND r.entry_time >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
  AND r.is_deleted = 0
  AND l.is_deleted = 0
ORDER BY r.entry_time DESC;
```

## Empty or missing data

- If the query returns no rows, tell the user "经查询，当前时间范围内暂无相关数据".
- If a code field has a value but its name field is empty (e.g. `event_level = '1'` but `event_level_name = ''`), infer and display the correct Chinese name (e.g. "一级预警").
- Do not output raw JSON unless the user asks for it.

## Response format

Return a Markdown answer with:

- A brief summary of what was queried and the actual time range
- Key numbers or a small table of results
- A short interpretation in Chinese
