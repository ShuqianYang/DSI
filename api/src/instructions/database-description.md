# Database Description

Model-visible catalog for SQL tool work. Pick the database alias, schema, and
table from this catalog, then use `SqlQuerySchema` to confirm exact column names
and foreign keys before writing `SqlQuery`.

**Workflow:** catalog table choice → `SqlQuerySchema` → `SqlQuery`.

**GIS bbox rule:** when a regional SQL query follows `RegionResolve`, reuse
`RegionResolve.selected.bbox` exactly. For SQL filters, map it as:

- `latitude BETWEEN selected.bbox.south AND selected.bbox.north`
- `longitude BETWEEN selected.bbox.west AND selected.bbox.east`

Do not widen, shrink, round, or replace the bbox for named regions or "nearby"
wording. If `RegionResolve.resolved=false`, do not invent coordinates; ask for
a bbox/polygon or say the region is not available.

Use `SqlQuerySchema` with the optional `table` parameter when the target table
is known:

```json
{"database":"default","schema":"agent_smoke","table":"incidents"}
```

If the target table is unknown, omit `table` to inspect the whole allowlisted
schema:

```json
{"database":"default","schema":"agent_smoke"}
```

If `artifact.path` is returned, the inline `rows` are a preview; use `Read` on
the path only when the full row set is needed.

---

## `default` / `public`

Application read models and operational data.

Use `SqlQuerySchema` to confirm the aircraft table before writing SQL:

```json
{"database":"default","schema":"public","table":"aircraft_current_states"}
```

`SqlQuerySchema` requires schema allowlisting. For aircraft queries, include
`public` in `AGENT_SQL_ALLOWED_SCHEMAS` for the `default` alias.

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `aircraft_current_states` | Hourly OpenSky current aircraft snapshot, refreshed by the backend queue/worker | `icao24`, `callsign`, `origin_country`, `longitude`, `latitude`, `baro_altitude`, `velocity`, `true_track`, `vertical_rate`, `on_ground`, `squawk`, `spi`, `position_source`, `category`, `source_time`, `updated_at`, `region`, `status` |

Aircraft regional queries against `aircraft_current_states` should filter by
`latitude` and `longitude` bbox. If the region came from RegionResolve, use
`RegionResolve.selected.bbox` exactly.
OpenSky `velocity` is stored as meters per second (`m/s`). When presenting
speed in `km/h`, convert with `velocity * 3.6`; never label raw `velocity`
values as `km/h`.
The current ingestion may leave `region` and `status` as empty strings, so do
not rely on them for regional filtering or risk classification unless
`SqlQuery` returns populated values.

Use `SqlQuerySchema` to confirm the AIS vessel table before writing SQL:

```json
{"database":"default","schema":"public","table":"ais_current_states"}
```

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `ais_current_states` | Hourly AIS vessel snapshot from aisstream.io, refreshed by the backend queue/worker | `mmsi`, `ship_name`, `call_sign`, `ship_type`, `longitude`, `latitude`, `sog`, `cog`, `heading`, `navigational_status`, `destination`, `source_time`, `updated_at` |

Vessel regional queries against `ais_current_states` should filter by
`latitude` and `longitude` bbox. If the region came from RegionResolve, use
`RegionResolve.selected.bbox` exactly.
The `ship_type` column may contain nulls for vessels without static data.

---

## `default` / `agent_smoke`

Security incidents, monitored systems, and audit events.

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `incidents` | Incident records | `type`, `severity`, `owner`, `status`, `description`, `created_at`, `resolved_at` |
| `systems` | Monitored assets | `name`, `region`, `environment`, `owner_team`, `cpu_usage`, `memory_usage`, `disk_usage`, `uptime_hours` |
| `incident_systems` | M:N link `incidents ↔ systems` | `incident_id → incidents.id`, `system_id → systems.id`, `impact` |
| `audit_log` | Audit events | `event_type`, `actor`, `target`, `details` (jsonb), `created_at` |

## `default` / `retail_demo`

Sales and refunds. Two semantically different tables with overlapping column
names — choose the right table based on question intent.

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `sales_orders` | Sales transactions | `amount`, `quantity`, `region`, `sales_rep`, `order_date`, `status` (completed/pending/cancelled) |
| `refund_records` | Refund requests | `refund_amount`, `reason`, `processed_by`, `refund_date`, `status` (approved/pending/rejected), `original_order_id` |

**Disambiguation:**
- Revenue / 销售额 → `sales_orders.amount`
- Refunds / 退款 → `refund_records.refund_amount`
- Net income / 净收入 → combine both tables

---

## `border-defense` / `xjzhdd_bj`

Border defense operational data stored in MySQL. Use `MysqlQuerySchema` to confirm exact column names before writing `MysqlQuery`.

**Workflow:** identify intent → `MysqlQuerySchema` (if needed) → `MysqlQuery`.

Use `MysqlQuerySchema` with the optional `table` parameter when the target table is known:

```json
{"database":"border-defense","table":"alarm_event"}
```

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `alarm_event` | Warning/alarm events | `event_id`, `warning_classification_name`, `event_level_name`, `event_time`, `device_id`, `device_name`, `longitude`, `latitude`, `owner_dept_id`, `owner_dept_name`, `handle_result`, `handle_user_name`, `handle_time`, `dispose_status`, `is_deleted`, `is_mock_data` |
| `buckle_access_record` | Checkpoint access logs | `id`, `object_id`, `object_category`, `entry_buckle_id`, `entry_buckle_name`, `entry_time`, `leave_buckle_id`, `leave_buckle_name`, `leave_time`, `alarm_level`, `match_result`, `alarm_time`, `is_deleted`, `is_mock_data` |
| `buckle_info` | Checkpoint metadata | `id`, `buckle_code`, `buckle_name`, `dept_id`, `longitude`, `latitude` |
| `buckle_access_list` | Person/vehicle registry | `id`, `object_name`, `object_category`, `object_type`, `license_number`, `alarm_level` |
| `buckle_access_stay_time` | Overstay duration config | `object_category`, `object_type`, `permit_stay_duration` |
| `sys_dept` | Department hierarchy | `dept_id`, `parent_id`, `dept_name`, `dept_level`, `status`, `longitude`, `latitude` |
| `tb_device` | Device/sensor inventory | `dev_id`, `dev_index_code`, `dev_name`, `dev_category`, `dev_type_code`, `manufacturer`, `longitude`, `latitude`, `install_place` |
| `make_rounds_record` | Patrol records | `id`, `rounds_time`, `user_name`, `dept_id`, `longitude`, `latitude` |

**Filtering conventions:**

- Always exclude logically deleted rows with `is_deleted = 0` unless asked otherwise.
- Default time window is the current month when the user does not specify one.
- Use `event_level_name` (not numeric `event_level`) for alarm-level grouping/labeling.
- For department-based queries, join `sys_dept` on `dept_id` or `owner_dept_id`.
- For device-based queries, join `tb_device` on `dev_id`/`device_id`.
