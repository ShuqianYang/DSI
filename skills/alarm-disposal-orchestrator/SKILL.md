---
name: alarm-disposal-orchestrator
description: Use when the user reports a portable smart device alarm or border intrusion warning and needs to drive the patrol resource dispatch workflow from alarm intake through trajectory prediction to a suggested allocation plan.
argument-hint: "[alarm JSON from portable device or natural language alarm description, optionally with patrol personnel positions]"
allowed-tools: Read, Bash, Write
---

# Alarm Disposal Orchestrator
Use this skill to turn a portable smart device alarm (UAV/UGV/dog person-detection warning) into a suggested patrol-resource dispatch plan. The skill writes the alarm into the weitong backend as a suspect event, pulls real-time device positions from the portable system, optionally mixes in user-supplied patrol personnel, then drives the same prediction + dispatch API chain used by `situation.vue`. The result is a **suggestion** of which devices should go where; it does not automatically send control commands to the portable system.

## Point-in-time snapshot (scope)

This skill produces a **single point-in-time dispatch suggestion**, not a live plan. It reads each resource's position once at trigger time, predicts the suspect's near-future point once, and calls dispatch once. The returned plan (resource assignments, ETAs, waypoints) reflects only that moment.

Because resources keep moving and the suspect trajectory keeps growing, the real-world optimal plan changes over time. This skill does **not** refresh or track. To get an updated plan after positions change, the user must trigger the skill again. Always frame the output as "based on positions at time T" rather than a standing plan.

## Required input

Pass the user's original alarm as `$ARGUMENTS`. The input should contain at minimum:

1. Alarm identity: `personId` / `currentTrackId` / `eventTime` / `imageUrl`.
2. Location: `longitude` and `latitude` (WGS-84).
3. Detecting device: `currentDeviceId` (the portable device that raised the alarm).
4. Optional context: `personType`, `personAction`, `personDistance`, `previousDeviceId`, `previousTrackId`.

If the user describes the alarm in natural language, extract these fields first. If latitude/longitude is missing, ask the user for it before proceeding.

## Form mode: ask before acting

If the input is natural language, partial JSON, or missing any of the four required fields (`longitude`, `latitude`, `eventTime`, `currentDeviceId`), do **not** call the script yet. Instead, reply with a Markdown form table showing which fields are missing and ask the user to fill them in.

Use this exact table shape:

```markdown
| 字段 | 状态 | 示例值 | 当前输入 |
|---|---|---|---|
| longitude（经度） | ❌ 缺失 | 87.617733 | - |
| latitude（纬度） | ❌ 缺失 | 43.792818 | - |
| eventTime（发生时间） | ❌ 缺失 | 2026-06-22 14:30:22 | - |
| currentDeviceId（发现设备） | ❌ 缺失 | device_track_007 | - |

请补全以上字段，我将继续驱动处置流程。
```

If a field is already provided, mark it `✅ 已提供` and show the current value in the last column. If the user provides all required fields in their next message, proceed to the workflow step.

For the patrol personnel supplement, use the same form approach: if not provided, ask the user with a small table:

```markdown
| 人员ID | 类型 | 经度 | 纬度 | 速度(m/s) |
|---|---|---|---|---|
| P_001 | person | 87.1500 | 43.9200 | 2.0 |
```

If the user says there are no personnel, record that explicitly as an empty array and continue.

## Patrol personnel supplement

Before calling dispatch, check whether the user has already provided on-site patrol personnel positions in the input. If provided, use them directly. **Only ask** if personnel information is missing.

The expected format is an array:

```json
[
  {"id": "P_001", "type": "person", "lng": 87.1500, "lat": 43.9200, "speed": 2.0},
  {"id": "P_002", "type": "person", "lng": 87.1510, "lat": 43.9210, "speed": 2.0}
]
```

If the user says there are no personnel, pass an empty array. Do not invent personnel positions.

## Data mapping (portable device → weitong)

### Alarm event mapping

| Portable field | weitong field | Note |
|---|---|---|
| `longitude` | `startLng` | WGS-84 |
| `latitude` | `startLat` | WGS-84 |
| `eventTime` | `createTime` | Format `yyyy-MM-dd HH:mm:ss` |
| `currentDeviceId` | `description` | Record the source device |
| `personType` + `personAction` | `title` | e.g. `边境入侵-迷彩服-行走` |
| `imageUrl` | `description` | Append to description |
| `personId` / `currentTrackId` | `description` | Append to description |

The created event starts with `status: pending`. The skill immediately moves it to `processing` before driving the workflow.

### Portable device → dispatch resource mapping

Call `GET {PORTABLE_DEVICE_BASE_URL}/home`. The response contains `uav`, `ugv`, `dog_x30`, and `dog_m20` arrays.

| Portable key | weitong `type` | position fields | speed field | default speed |
|---|---|---|---|---|
| `uav` | `drone` | `longitude`, `latitude` | `horizontal_speed` | 15.0 m/s |
| `ugv` | `car` | `longitude`, `latitude` | `vehicle_current_speed * 0.01` | 5.0 m/s |
| `dog_x30` | `dog` | `longitude`, `latitude` | `speed` | 2.0 m/s |
| `dog_m20` | `dog` | `longitude`, `latitude` | `speed` | 2.0 m/s |

Filter rules:

- `uav`: include when `mode_code` indicates online/available.
- `ugv`: include when `status` is 1 (idle) or 2 (working) and position is valid.
- `dog_x30` / `dog_m20`: include when `status` is idle/working, `location == 0` (定位正常), and position is valid.

Map each included device to:

```json
{
  "id": "<device_id>",
  "type": "<mapped_type>",
  "current_pos": {"lng": <longitude>, "lat": <latitude>},
  "speed": <computed_speed>,
  "capture_capable": true
}
```

Merge the user-supplied personnel array into `resources_available` before dispatch.

## Resource source fallback (simulator)

The portable device system (`GET {PORTABLE_DEVICE_BASE_URL}/home`) is the default resource source. When it is unreachable or returns no usable devices, the script falls back to the **simulator** source, which mirrors `patrol_simulator/simulator.py` and the dispatch service:

- Device catalog (`id`, `type`, `speed`, `is_dispatched`) from the Postgres `patrol_resource` table. `type` is already `drone`/`car`/`person`/`dog`, so no remap is needed.
- Live position from Redis `realtime:patrol_resource:{id}` first, then the latest `patrol_resource_position` DB row as a fallback. Resources that are currently dispatched (busy) or have no known position are skipped.

Control it with `--resource-source`:

- `--resource-source portable` (default): read `/home`; auto-fall back to simulator if it returns nothing.
- `--resource-source simulator`: force the DB + Redis source (skip `/home` entirely).

The fallback requires the `patrol_simulator/simulator.py` process to be running so that live positions exist in Redis (or the DB). If neither store has positions, the simulator source returns zero resources.

For testing without running the full simulator, `scripts/seed_positions.py` writes one position per `patrol_resource` row directly into Redis (`realtime:patrol_resource:{id}`). Use `--near-lng/--near-lat/--radius-m` to cluster resources around the alarm so they fall inside the dispatch radius.

DB/Redis connection reuses the same env vars as `simulator.py` (`DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `REDIS_HOST`, `REDIS_PORT`, `REDIS_DB`, `REDIS_PASSWORD`). `DB_HOST` and `REDIS_HOST` default to the host parsed from `WEITONG_BASE_URL`. The simulator source needs the `psycopg2` and `redis` Python packages installed.

## Border / terrain data

Before trajectory prediction, the script loads preset border and camera data from the weitong backend:

- `GET /dev-api/api/v1/patrol/boundaries` — returns `PatrolBoundary` records with `points: [{lng, lat, seq}]`.
- `GET /dev-api/api/v1/patrol/cameras` — returns `PatrolCamera` records with `lng` and `lat`.

For each boundary, the script computes a center point and an approximate radius from its points and emits a `special_areas` entry of type `border` with `influence_factor: 0.8` (configurable via `BORDER_INFLUENCE_FACTOR`). If no boundaries exist, it falls back to an approximation derived from camera positions. This data is injected into the `terrain_map` payload sent to `/trajrp/api/v1/prediction/trajectory_forecast` so the prediction model can account for the border line.

Preset data source:

- Boundary/camera records live in the `patrol_boundary` and `patrol_camera` tables.
- They are initialized from `weitong/sql/06_patrol_camera_boundary.sql` when PostgreSQL first starts with an empty volume.
- Adjust them by editing the SQL init file (then reinitialize the database) or by calling the patrol camera/boundary management APIs in the running system.

Set `USE_BOUNDARY_DATA=false` to disable this enrichment entirely.

## Workflow

1. Parse the alarm. If any required field is missing, enter **form mode** and ask the user to fill in the blanks.
2. Validate `longitude`, `latitude`, `eventTime`, and `currentDeviceId`.
3. If patrol personnel positions are not already in the input, ask the user via the personnel form. If already provided (or the user says there are none), use that array directly.
4. Create the input JSON files with the `Write` tool, then call the orchestrator script via Bash.

   **Important:** Do **not** use Bash redirection (`>` / `>>`) or `python -c` to create files. The agent-loop sandbox blocks shell redirection, and Python may not be installed or may still be initializing. Use the `Write` tool to create the following files with exact absolute paths:

   - `S:/Projects/projects_new/skills/alarm-disposal-orchestrator/alarm.json`
   - `S:/Projects/projects_new/skills/alarm-disposal-orchestrator/personnel.json`

   If the user said there are no patrol personnel, write `[]` to `personnel.json`.

   Then run the script via the workspace wrapper script (it hardcodes the Python interpreter path to avoid the agent-loop Bash sandbox's PyManager issue):

   ```bash
   cd "S:/Projects/projects_new/skills/alarm-disposal-orchestrator" && run-orchestrate.cmd --alarm-file "S:/Projects/projects_new/skills/alarm-disposal-orchestrator/alarm.json" --personnel-file "S:/Projects/projects_new/skills/alarm-disposal-orchestrator/personnel.json"
   ```

   **Do not** call `python scripts/orchestrate.py` directly from the agent-loop Bash sandbox, because the sandbox cannot resolve the PyManager Python runtime.

   If you need to force a specific resource source, add `--resource-source simulator` or pass `--static-resources-file <path>` instead of `--resource-source`.

   The script expects:
   - `--alarm`: a single JSON object with the portable alarm. Optional when `--event-id` is given.
   - `--alarm-file`: path to a UTF-8 file holding the alarm JSON. Use instead of `--alarm` to avoid shell quoting; takes precedence over `--alarm`.
   - `--personnel`: a JSON array of manually supplied personnel resources (can be `[]`).
   - `--personnel-file`: path to a UTF-8 file holding the personnel JSON array. Takes precedence over `--personnel`.
   - `--resource-source` (optional): `portable` (default, auto-falls back to simulator) or `simulator` (force DB + Redis).
   - `--event-id` (optional): reuse an existing suspect event instead of creating a new one. Re-runs prediction + dispatch against current resource positions to produce a fresh point-in-time plan **without creating a duplicate event**. Use this when the user asks for an updated plan for an alarm that was already raised. On reuse, the event's previous active allocations are cancelled first (resources released) so the refreshed plan is clean; pass `--keep-previous-allocations` to skip that.
   - `--static-resources` (optional): a JSON array `[{"id","type","lng","lat","speed"}]` used directly as the dispatch resource list. Overrides `--resource-source` and makes no DB/Redis/portable calls — use it for fixed launch pads / posts or pure static-point demos. `type` should be `drone`/`car`/`dog`/`person`. Because these ids are not real `patrol_resource` rows, the active-allocation poll stays empty and the plan is taken from the dispatch response instead (see `plan` below).
   - `--static-resources-file` (optional): path to a UTF-8 file holding the static resources JSON array. Takes precedence over `--static-resources`.
5. The script:
   - Creates a suspect event via `POST /dev-api/api/v1/external/suspect/events`.
   - Updates status to `processing` via `PUT /dev-api/api/v1/external/suspect/events/{id}/status`.
   - Fetches the event trajectory via `GET /dev-api/api/v1/suspect/events/{id}?limit=60`.
   - Runs blind-spot completion via `POST /completion/api/v1/prediction/blind_spot_completion`.
   - Fetches preset border/terrain data from weitong (`GET /dev-api/api/v1/patrol/boundaries` and `/cameras`) and builds `special_areas` for the terrain map.
   - Runs trajectory prediction via `POST /trajrp/api/v1/prediction/trajectory_forecast`.
   - Fetches portable device data via `GET {PORTABLE_DEVICE_BASE_URL}/home`.
   - Maps devices and merges with user personnel to build `resources_available`.
   - Calls resource dispatch via `POST /dispatch/api/v1/dispatch/resource_allocation`.
   - Polls the active allocation via `GET /dispatch/api/v1/dispatch/allocation/active?event_id={id}`.
   - Returns the suggested allocation plan as JSON.
6. Summarize the suggested plan to the user. Do not claim capture success unless `capture_feasible` is true and at least one allocation has an ETA. Do not send any control command to the portable system.

## Environment defaults

The script reads these environment variables:

- `WEITONG_BASE_URL` — default `http://192.168.0.27`
- `PORTABLE_DEVICE_BASE_URL` — default `http://192.168.0.33:5284`
- `TASK_ID` — default `cost_fixed_task_001`
- `POLL_INTERVAL_SECONDS` — default `2`
- `MAX_POLL_ROUNDS` — default `10`
- `USE_BOUNDARY_DATA` — default `true`; set to `false` to skip border/terrain enrichment
- `BORDER_INFLUENCE_FACTOR` — default `0.8`; factor passed for each border special area in the prediction terrain map

Simulator fallback source (only used when `/home` is unavailable or `--resource-source simulator`):

- `DB_HOST` / `REDIS_HOST` — default to the host of `WEITONG_BASE_URL`
- `DB_PORT` (default `5432`), `DB_NAME` (default `postgres`), `DB_USER` (default `postgres`), `DB_PASSWORD` (default `123456`)
- `REDIS_PORT` (default `6379`), `REDIS_DB` (default `0`), `REDIS_PASSWORD` (default none)

## Rules

- Do not call the script if `longitude` or `latitude` is missing.
- Do not invent alarm fields or personnel positions. Ask the user for missing required data.
- If the script returns a non-JSON error, echo the raw error to the user and stop.
- Treat the dispatch result as a **suggestion only**. Do not call `POST /Remote/send` or any other portable device control interface.
- Treat the plan as a **point-in-time snapshot**. Do not imply it auto-updates or that resources will keep heading to the listed targets. If the user asks for the latest plan after some time, re-run with `--event-id <id>` to refresh the same event (avoids creating a duplicate event); only omit `--event-id` for a genuinely new alarm.
- If `capture_feasible` is false, report the reason and the closest available resources; do not claim the suspect is intercepted.
- If the allocation plan includes dispatched resources, list `resourceId`, `type`, `etaSeconds`, and target coordinates.
- Do not automatically mark the event `resolved`; leave that to the user or to a follow-up capture-success confirmation.

## Response format

Return a Markdown summary containing:

- The created (or reused) weitong `eventId`.
- The alarm coordinates and timestamp used.
- Whether dispatch is feasible (`capture_feasible`).
- The suggested allocation plan table: read from the script's `plan` field (`resourceId`, `type`, `etaSeconds`, `targetLng`, `targetLat`, `action`). `plan` prefers the DB-backed active allocations and falls back to the dispatch response (used for static resources). A `null` target means the planner returned no usable coordinate for that resource.
- The list of resources that were considered (portable devices + personnel).
- Any error or warning from the script.
- A closing note stating the plan is a snapshot based on resource positions at the alarm timestamp, and that a fresh trigger is needed for an updated plan.

Do not output raw JSON unless the user explicitly asks for it.
