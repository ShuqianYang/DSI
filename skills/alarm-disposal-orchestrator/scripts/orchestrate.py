#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Alarm disposal orchestrator.

Drives the weitong + TrajRP + dispatch flow from a portable smart device alarm:
  1. Create suspect event
  2. Update status -> processing
  3. Fetch trajectory
  4. Blind-spot completion
  5. Trajectory prediction
  6. Fetch portable device positions
  7. Resource dispatch
  8. Poll active allocation

Outputs a JSON object describing the suggested allocation plan.
"""

import argparse
import json
import logging
import os
import sys
import time
from datetime import datetime
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


logger = logging.getLogger("alarm-orchestrator")


# ---------------------------------------------------------------------------
# Environment defaults
# ---------------------------------------------------------------------------
WEITONG_BASE_URL = os.environ.get("WEITONG_BASE_URL", "http://192.168.0.27").rstrip("/")
PORTABLE_BASE_URL = os.environ.get("PORTABLE_DEVICE_BASE_URL", "http://192.168.0.33:5284").rstrip("/")
TASK_ID = os.environ.get("TASK_ID", "cost_fixed_task_001")
POLL_INTERVAL = float(os.environ.get("POLL_INTERVAL_SECONDS", "2"))
MAX_POLL_ROUNDS = int(os.environ.get("MAX_POLL_ROUNDS", "10"))
USE_BOUNDARY_DATA = os.environ.get("USE_BOUNDARY_DATA", "true").lower() in ("1", "true", "yes")
BORDER_INFLUENCE_FACTOR = float(os.environ.get("BORDER_INFLUENCE_FACTOR", "0.8"))


# Simulator fallback: read patrol_resource catalog from Postgres and live
# positions from Redis (the same stores patrol_simulator/dispatch use).
# Host defaults are derived from WEITONG_BASE_URL so a single base URL is enough.
def _weitong_host(default: str = "127.0.0.1") -> str:
    host = urlparse(WEITONG_BASE_URL).hostname
    return host or default


DB_HOST = os.environ.get("DB_HOST", _weitong_host())
DB_PORT = int(os.environ.get("DB_PORT", "5432"))
DB_NAME = os.environ.get("DB_NAME", "postgres")
DB_USER = os.environ.get("DB_USER", "postgres")
DB_PASSWORD = os.environ.get("DB_PASSWORD", "123456")
REDIS_HOST = os.environ.get("REDIS_HOST", _weitong_host())
REDIS_PORT = int(os.environ.get("REDIS_PORT", "6379"))
REDIS_DB = int(os.environ.get("REDIS_DB", "0"))
REDIS_PASSWORD = os.environ.get("REDIS_PASSWORD") or None


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------
def http_request(
    method: str,
    url: str,
    data: dict | None = None,
    headers: dict | None = None,
    timeout: int = 60,
) -> dict:
    """Make an HTTP request and return parsed JSON."""
    h = {"Content-Type": "application/json", "Accept": "application/json"}
    if headers:
        h.update(headers)

    body = None
    if data is not None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")

    req = Request(url, data=body, headers=h, method=method.upper())

    try:
        with urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            if not raw:
                return {}
            return json.loads(raw)
    except HTTPError as exc:
        try:
            raw = exc.read().decode("utf-8") if exc.fp else ""
        except Exception:
            raw = ""
        try:
            detail = json.loads(raw) if raw else {}
        except Exception:
            detail = {"raw": raw}
        raise RuntimeError(f"HTTP {exc.code} from {url}: {detail}") from exc
    except URLError as exc:
        raise RuntimeError(f"Request failed for {url}: {exc.reason}") from exc
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Invalid JSON from {url}: {exc}") from exc


def post(url: str, data: dict | None = None, timeout: int = 60) -> dict:
    return http_request("POST", url, data=data, timeout=timeout)


def get(url: str, timeout: int = 60) -> dict:
    return http_request("GET", url, timeout=timeout)


def put(url: str, data: dict | None = None, timeout: int = 60) -> dict:
    return http_request("PUT", url, data=data, timeout=timeout)


# ---------------------------------------------------------------------------
# Alarm parsing
# ---------------------------------------------------------------------------
def parse_alarm(alarm: dict) -> dict:
    """Normalize portable alarm into weitong suspect_event payload."""
    longitude = alarm.get("longitude")
    latitude = alarm.get("latitude")
    if longitude is None or latitude is None:
        raise ValueError("Alarm must contain longitude and latitude")

    event_time = alarm.get("eventTime") or datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # Build description from available context
    parts = []
    if alarm.get("personId"):
        parts.append(f"personId={alarm['personId']}")
    if alarm.get("currentDeviceId"):
        parts.append(f"currentDeviceId={alarm['currentDeviceId']}")
    if alarm.get("currentTrackId"):
        parts.append(f"currentTrackId={alarm['currentTrackId']}")
    if alarm.get("previousDeviceId"):
        parts.append(f"previousDeviceId={alarm['previousDeviceId']}")
    if alarm.get("previousTrackId"):
        parts.append(f"previousTrackId={alarm['previousTrackId']}")
    if alarm.get("imageUrl"):
        parts.append(f"imageUrl={alarm['imageUrl']}")

    person_type = alarm.get("personType")
    person_action = alarm.get("personAction")
    title_parts = ["边境入侵"]
    if person_type is not None:
        title_parts.append(f"人员类型{person_type}")
    if person_action is not None:
        title_parts.append(f"动作{person_action}")
    title = "-".join(title_parts)

    description = "; ".join(parts) if parts else "便携设备智能预警"

    return {
        "title": title,
        "description": description,
        "status": "pending",
        "startLng": float(longitude),
        "startLat": float(latitude),
        "createTime": event_time,
        "trajectory": [
            {
                "lng": float(longitude),
                "lat": float(latitude),
                "recordTime": event_time,
            }
        ],
    }


# ---------------------------------------------------------------------------
# Portable device mapping
# ---------------------------------------------------------------------------
def _speed_mps(value: Any, factor: float = 1.0, default: float = 0.0) -> float:
    try:
        v = float(value) * factor
        return v if v > 0 else default
    except (TypeError, ValueError):
        return default


def map_uav(uav: dict) -> dict | None:
    lng = uav.get("longitude")
    lat = uav.get("latitude")
    if lng is None or lat is None:
        return None
    return {
        "id": str(uav.get("device_id") or uav.get("eqpt_no") or "uav_unknown"),
        "type": "drone",
        "current_pos": {"lng": float(lng), "lat": float(lat)},
        "speed": _speed_mps(uav.get("horizontal_speed"), default=15.0),
        "capture_capable": True,
    }


def map_ugv(ugv: dict) -> dict | None:
    lng = ugv.get("longitude")
    lat = ugv.get("latitude")
    if lng is None or lat is None:
        return None
    status = ugv.get("status")
    if status not in (0, 1, 2):  # 0 idle/offline-ish, 1 idle, 2 working
        # Be conservative: still include if status is missing/unknown
        pass
    return {
        "id": str(ugv.get("device_id") or ugv.get("device_no") or "ugv_unknown"),
        "type": "car",
        "current_pos": {"lng": float(lng), "lat": float(lat)},
        "speed": _speed_mps(ugv.get("vehicle_current_speed"), factor=0.01, default=5.0),
        "capture_capable": True,
    }


def map_dog(dog: dict) -> dict | None:
    lng = dog.get("longitude")
    lat = dog.get("latitude")
    if lng is None or lat is None:
        return None
    return {
        "id": str(dog.get("device_id") or dog.get("eqpt_no") or "dog_unknown"),
        "type": "dog",
        "current_pos": {"lng": float(lng), "lat": float(lat)},
        "speed": _speed_mps(dog.get("speed"), default=2.0),
        "capture_capable": True,
    }


def fetch_portable_devices() -> list[dict]:
    """Fetch and map portable devices from /home."""
    url = f"{PORTABLE_BASE_URL}/home"
    logger.info("Fetching portable devices from %s", url)
    try:
        data = get(url, timeout=20)
    except Exception as exc:
        logger.warning("Failed to fetch portable devices: %s", exc)
        return []

    resources: list[dict] = []

    for uav in data.get("uav") or []:
        mapped = map_uav(uav)
        if mapped:
            resources.append(mapped)

    for ugv in data.get("ugv") or []:
        mapped = map_ugv(ugv)
        if mapped:
            resources.append(mapped)

    for dog in (data.get("dog_x30") or []) + (data.get("dog_m20") or []):
        mapped = map_dog(dog)
        if mapped:
            resources.append(mapped)

    logger.info("Mapped %d portable devices", len(resources))
    return resources


# ---------------------------------------------------------------------------
# Simulator fallback (DB catalog + Redis live positions)
# ---------------------------------------------------------------------------
def _fetch_redis_positions(resource_ids: list[int]) -> dict[int, dict]:
    """Read live positions from Redis realtime:patrol_resource:{id} (preferred source)."""
    try:
        import redis  # lazy: only needed in simulator mode
    except ImportError:
        logger.warning("redis driver not installed; skipping Redis live positions")
        return {}

    positions: dict[int, dict] = {}
    try:
        client = redis.Redis(
            host=REDIS_HOST, port=REDIS_PORT, db=REDIS_DB,
            password=REDIS_PASSWORD, decode_responses=True, socket_timeout=5,
        )
        client.ping()
        with client.pipeline() as pipe:
            for rid in resource_ids:
                pipe.hgetall(f"realtime:patrol_resource:{rid}")
            rows = pipe.execute()
        for rid, data in zip(resource_ids, rows):
            if data and data.get("lng") and data.get("lat"):
                try:
                    positions[rid] = {"lng": float(data["lng"]), "lat": float(data["lat"])}
                except (TypeError, ValueError):
                    continue
    except Exception as exc:
        logger.warning("Failed to read Redis positions: %s", exc)
    return positions


def fetch_simulator_resources() -> list[dict]:
    """Fallback resource source: patrol_resource catalog (Postgres) + live positions.

    Mirrors patrol_simulator/dispatch behavior: live position comes from Redis
    `realtime:patrol_resource:{id}` first, then falls back to the latest
    `patrol_resource_position` DB row. Resources currently dispatched (busy) and
    resources without any known position are skipped.
    """
    try:
        import psycopg2  # lazy: only needed in simulator mode
    except ImportError:
        raise RuntimeError(
            "simulator resource source requires psycopg2 (pip install psycopg2-binary)"
        )

    logger.info("Fetching simulator resources from DB %s:%s/%s", DB_HOST, DB_PORT, DB_NAME)
    conn = psycopg2.connect(
        host=DB_HOST, port=DB_PORT, dbname=DB_NAME,
        user=DB_USER, password=DB_PASSWORD, connect_timeout=8,
    )
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT id, type, speed, is_dispatched FROM patrol_resource ORDER BY id"
        )
        catalog = [
            {"id": r[0], "type": r[1], "speed": float(r[2] or 0), "is_dispatched": bool(r[3])}
            for r in cur.fetchall()
        ]
        available = [c for c in catalog if not c["is_dispatched"]]
        ids = [c["id"] for c in available]
        logger.info(
            "Loaded %d patrol_resource rows (%d available, %d busy)",
            len(catalog), len(available), len(catalog) - len(available),
        )

        # Live positions: Redis first.
        positions = _fetch_redis_positions(ids) if ids else {}

        # DB fallback for resources missing from Redis.
        missing = [rid for rid in ids if rid not in positions]
        if missing:
            cur.execute(
                "SELECT pr.id, prp.lng, prp.lat FROM patrol_resource pr "
                "JOIN LATERAL (SELECT lng, lat FROM patrol_resource_position prp2 "
                "WHERE prp2.resource_id = pr.id ORDER BY record_time DESC LIMIT 1) prp "
                "ON true WHERE pr.id = ANY(%s)",
                (missing,),
            )
            for rid, lng, lat in cur.fetchall():
                if lng is not None and lat is not None:
                    positions[rid] = {"lng": float(lng), "lat": float(lat)}
        cur.close()
    finally:
        conn.close()

    resources: list[dict] = []
    for c in available:
        pos = positions.get(c["id"])
        if not pos:
            continue
        resources.append(
            {
                "id": str(c["id"]),
                "type": c["type"],  # drone/car/person/dog already match dispatch
                "current_pos": {"lng": pos["lng"], "lat": pos["lat"]},
                "speed": c["speed"] if c["speed"] > 0 else 5.0,
                "capture_capable": True,
            }
        )

    logger.info("Mapped %d simulator resources with live positions", len(resources))
    return resources


def normalize_static_resources(items: list[dict]) -> list[dict]:
    """Normalize user-supplied static resource points into dispatch resource dicts.

    Each item: {id, type, lng, lat, speed?, capture_capable?}. `type` should be
    one of drone/car/dog/person (passed through to dispatch unchanged).
    """
    out: list[dict] = []
    for i, p in enumerate(items):
        lng = p.get("lng")
        lat = p.get("lat")
        if lng is None or lat is None:
            continue
        out.append(
            {
                "id": str(p.get("id") or f"static_{i}"),
                "type": str(p.get("type") or "person"),
                "current_pos": {"lng": float(lng), "lat": float(lat)},
                "speed": _speed_mps(p.get("speed"), default=5.0),
                "capture_capable": bool(p.get("capture_capable", True)),
            }
        )
    return out


# ---------------------------------------------------------------------------
# Trajectory helpers
# ---------------------------------------------------------------------------
def normalize_trajectory(points: list[dict]) -> list[dict]:
    """Convert backend trajectory points into {lng, lat, timestamp}."""
    out = []
    for i, p in enumerate(points):
        lng = p.get("lng")
        lat = p.get("lat")
        if lng is None or lat is None:
            continue
        ts = 0.0
        if p.get("recordTime"):
            try:
                ts = datetime.strptime(p["recordTime"], "%Y-%m-%d %H:%M:%S").timestamp()
            except Exception:
                ts = float(i * 10)
        elif p.get("timestamp") is not None:
            ts = float(p["timestamp"])
        else:
            ts = float(i * 10)
        out.append({"lng": float(lng), "lat": float(lat), "timestamp": ts})
    return out


def to_prediction_input(points: list[dict]) -> list[dict]:
    return [
        {
            "x": p["lng"],
            "y": p["lat"],
            "timestamp": i * 10.0,
            "speed": 1.5,
        }
        for i, p in enumerate(points)
    ]


def to_completion_input(points: list[dict]) -> list[dict]:
    return [
        {
            "x": p["lng"],
            "y": p["lat"],
            "timestamp": p["timestamp"],
            "speed": 1.5,
        }
        for p in points
    ]


# ---------------------------------------------------------------------------
# Border / terrain data
# ---------------------------------------------------------------------------
def _center_and_radius(points: list[dict]) -> tuple[dict, float] | None:
    """Compute center {x:lng, y:lat} and approximate radius (degrees) for a point set."""
    if not points:
        return None
    lats = [p["lat"] for p in points]
    lons = [p["lng"] for p in points]
    center = {"x": sum(lons) / len(lons), "y": sum(lats) / len(lats)}
    max_dist = 0.0
    for p in points:
        dx = p["lng"] - center["x"]
        dy = p["lat"] - center["y"]
        d = (dx * dx + dy * dy) ** 0.5
        if d > max_dist:
            max_dist = d
    # radius in degrees; add small buffer so the whole line is inside influence
    return center, max(max_dist * 1.2, 0.001)


def fetch_boundaries() -> list[dict]:
    """Fetch patrol boundaries from weitong."""
    url = f"{WEITONG_BASE_URL}/dev-api/api/v1/patrol/boundaries"
    logger.info("Fetching boundaries from %s", url)
    try:
        resp = get(url, timeout=20)
        if resp.get("code") == 200:
            return resp.get("data") or []
    except Exception as exc:
        logger.warning("Failed to fetch boundaries: %s", exc)
    return []


def fetch_cameras() -> list[dict]:
    """Fetch patrol cameras from weitong."""
    url = f"{WEITONG_BASE_URL}/dev-api/api/v1/patrol/cameras"
    logger.info("Fetching cameras from %s", url)
    try:
        resp = get(url, timeout=20)
        if resp.get("code") == 200:
            return resp.get("data") or []
    except Exception as exc:
        logger.warning("Failed to fetch cameras: %s", exc)
    return []


def build_special_areas(boundaries: list[dict], cameras: list[dict]) -> list[dict]:
    """Build special_areas for terrain_map from preset boundary/camera data."""
    areas = []

    for boundary in boundaries:
        raw_points = boundary.get("points") or []
        points = [
            {"lng": float(p["lng"]), "lat": float(p["lat"])}
            for p in raw_points
            if p.get("lng") is not None and p.get("lat") is not None
        ]
        cr = _center_and_radius(points)
        if cr:
            center, radius = cr
            areas.append(
                {
                    "type": "border",
                    "center": center,
                    "radius": radius,
                    "influence_factor": BORDER_INFLUENCE_FACTOR,
                }
            )

    # If no boundaries, approximate border from camera positions (they are usually lined along the border)
    if not boundaries and cameras:
        points = [
            {"lng": float(c["lng"]), "lat": float(c["lat"])}
            for c in cameras
            if c.get("lng") is not None and c.get("lat") is not None
        ]
        cr = _center_and_radius(points)
        if cr:
            center, radius = cr
            areas.append(
                {
                    "type": "border",
                    "center": center,
                    "radius": radius,
                    "influence_factor": BORDER_INFLUENCE_FACTOR,
                }
            )

    return areas


def build_terrain_map(points: list[dict], special_areas: list[dict] | None = None) -> dict:
    """Build a terrain map for prediction, optionally including preset border/terrain special_areas."""
    return {
        "metadata": {"height": 100, "width": 100},
        "terrain_data": [[0] * 100 for _ in range(100)],
        "special_areas": special_areas or [],
    }


# ---------------------------------------------------------------------------
# Main orchestration
# ---------------------------------------------------------------------------
def run(
    alarm: dict | None,
    personnel: list[dict],
    resource_source: str = "portable",
    event_id: int | None = None,
    finish_previous: bool = True,
    static_resources: list[dict] | None = None,
) -> dict:
    result = {
        "eventId": None,
        "reused_event": event_id is not None,
        "alarm": {"lng": None, "lat": None, "time": None},
        "trajectory_count": 0,
        "portable_devices_count": 0,
        "personnel_count": len(personnel),
        "resource_source": resource_source,
        "prediction_candidates": [],
        "dispatch": None,
        "allocation": None,
        "capture_feasible": False,
        "warnings": [],
        "errors": [],
    }

    # 1. Parse alarm (optional when reusing an existing event)
    event_payload = None
    fallback_pos = None
    if alarm:
        try:
            event_payload = parse_alarm(alarm)
        except ValueError as exc:
            result["errors"].append(str(exc))
            return result
        result["alarm"]["lng"] = event_payload["startLng"]
        result["alarm"]["lat"] = event_payload["startLat"]
        result["alarm"]["time"] = event_payload["createTime"]
        fallback_pos = event_payload["trajectory"][0]
    elif event_id is None:
        result["errors"].append("alarm is required unless event_id is given")
        return result

    # 2. Create event (skipped when reusing an existing event_id)
    if event_id is None:
        create_url = f"{WEITONG_BASE_URL}/dev-api/api/v1/external/suspect/events"
        logger.info("Creating suspect event at %s", create_url)
        try:
            create_resp = post(create_url, event_payload, timeout=30)
            if create_resp.get("code") != 200:
                result["errors"].append(f"Create event failed: {create_resp}")
                return result
            event_id = create_resp["data"]["eventId"]
        except Exception as exc:
            result["errors"].append(f"Create event error: {exc}")
            return result
    else:
        logger.info("Reusing existing suspect event %s (skip create)", event_id)
    result["eventId"] = event_id

    # 3. Update status to processing
    try:
        status_url = f"{WEITONG_BASE_URL}/dev-api/api/v1/external/suspect/events/{event_id}/status"
        put(status_url, {"status": "processing"}, timeout=30)
    except Exception as exc:
        result["warnings"].append(f"Update status to processing failed: {exc}")

    # 3b. When reusing an event, cancel its previous active allocations first so
    # the refreshed plan is clean and the previously-busy resources are released
    # (is_dispatched -> false) before we fetch the resource list.
    if result["reused_event"] and finish_previous:
        try:
            finish_url = f"{WEITONG_BASE_URL}/dispatch/api/v1/dispatch/allocation/finish"
            finish_resp = post(finish_url, {"event_id": event_id, "status": "cancelled"}, timeout=30)
            data = finish_resp.get("data") or {}
            result["previous_allocations_cancelled"] = data.get("allocations_affected", 0)
            result["previous_resources_released"] = data.get("resources_released", 0)
        except Exception as exc:
            result["warnings"].append(f"Finish previous allocations failed: {exc}")

    # 4. Fetch trajectory
    try:
        event_url = f"{WEITONG_BASE_URL}/dev-api/api/v1/suspect/events/{event_id}?limit=60"
        event_detail = get(event_url, timeout=30)
        traj_points = []
        if event_detail.get("code") == 200 and event_detail.get("data"):
            data = event_detail["data"]
            traj_points = normalize_trajectory(data.get("trajectory") or [])
            # Derive a fallback current position from the event itself (used when
            # reusing an event_id without a fresh alarm and the trajectory is empty).
            if fallback_pos is None:
                cur_lng = data.get("currentLng") if data.get("currentLng") is not None else data.get("startLng")
                cur_lat = data.get("currentLat") if data.get("currentLat") is not None else data.get("startLat")
                if cur_lng is not None and cur_lat is not None:
                    fallback_pos = {"lng": float(cur_lng), "lat": float(cur_lat)}
        result["trajectory_count"] = len(traj_points)
    except Exception as exc:
        result["warnings"].append(f"Fetch trajectory failed: {exc}")
        traj_points = []

    # 5. Blind-spot completion
    completed_points = traj_points
    if len(traj_points) >= 2:
        try:
            completion_url = f"{WEITONG_BASE_URL}/completion/api/v1/prediction/blind_spot_completion"
            completion_payload = {
                "trajectory": to_completion_input(traj_points),
                "target_type": "pedestrian",
                "task_id": TASK_ID,
                "completion_config": {
                    "points_per_gap": 5,
                    "interpolation_method": "path_planning",
                },
            }
            completion_resp = post(completion_url, completion_payload, timeout=60)
            if completion_resp.get("code") == 200 and completion_resp.get("data"):
                raw = completion_resp["data"].get("completed_trajectory") or []
                completed_points = [
                    {"lng": float(p["x"]), "lat": float(p["y"]), "timestamp": float(p.get("timestamp", 0))}
                    for p in raw
                    if p.get("x") is not None and p["y"] is not None
                ]
                if completed_points:
                    traj_points = completed_points
                    result["trajectory_count"] = len(traj_points)
        except Exception as exc:
            result["warnings"].append(f"Blind-spot completion failed: {exc}")

    # 6. Build terrain map with border/terrain data
    special_areas = []
    if USE_BOUNDARY_DATA:
        try:
            boundaries = fetch_boundaries()
            cameras = fetch_cameras()
            special_areas = build_special_areas(boundaries, cameras)
            result["boundaries_count"] = len(boundaries)
            result["cameras_count"] = len(cameras)
        except Exception as exc:
            result["warnings"].append(f"Border/terrain data enrichment failed: {exc}")

    # 7. Trajectory prediction
    predicted_candidates = []
    if len(traj_points) >= 2:
        try:
            predict_url = f"{WEITONG_BASE_URL}/trajrp/api/v1/prediction/trajectory_forecast"
            predict_payload = {
                "historical_trajectory": to_prediction_input(traj_points),
                "terrain_map": build_terrain_map(traj_points, special_areas),
                "prediction_config": {
                    "prediction_method": "method2",
                    "use_data_speed": False,
                    "num_candidates": 5,
                    "max_distance": 2000,
                    "minutes_ahead": 0.5,
                },
                "task_id": TASK_ID,
            }
            predict_resp = post(predict_url, predict_payload, timeout=60)
            if predict_resp.get("code") == 200 and predict_resp.get("data"):
                candidates = predict_resp["data"].get("candidate_points") or []
                predicted_candidates = [
                    {
                        "candidate_id": c.get("candidate_id"),
                        "x": c.get("x"),
                        "y": c.get("y"),
                        "probability": c.get("probability"),
                        "timestamp": c.get("timestamp"),
                        "distance_meters": c.get("distance_meters"),
                    }
                    for c in candidates
                ]
                result["prediction_candidates"] = predicted_candidates
        except Exception as exc:
            result["warnings"].append(f"Trajectory prediction failed: {exc}")

    # 7. Fetch resources (static > portable, with simulator fallback) and merge with personnel
    portable_resources: list[dict] = []
    if static_resources is not None:
        # Explicit static points: bypass portable/simulator/DB/Redis entirely.
        portable_resources = normalize_static_resources(static_resources)
        result["resource_source"] = "static"
    elif resource_source == "simulator":
        # Forced simulator mode.
        try:
            portable_resources = fetch_simulator_resources()
            result["resource_source"] = "simulator"
        except Exception as exc:
            result["errors"].append(f"Simulator resource fetch failed: {exc}")
            return result
    else:
        # Default: portable, with automatic fallback to simulator when /home
        # is unreachable or returns no usable devices.
        portable_resources = fetch_portable_devices()
        if not portable_resources:
            result["warnings"].append(
                "Portable /home returned no devices; falling back to simulator resource source"
            )
            try:
                portable_resources = fetch_simulator_resources()
                result["resource_source"] = "simulator"
            except Exception as exc:
                result["warnings"].append(f"Simulator fallback failed: {exc}")

    result["portable_devices_count"] = len(portable_resources)

    # Normalize personnel
    normalized_personnel = []
    for p in personnel:
        if p.get("lng") is None or p.get("lat") is None:
            continue
        normalized_personnel.append(
            {
                "id": str(p.get("id") or f"person_{len(normalized_personnel)}"),
                "type": str(p.get("type") or "person"),
                "current_pos": {"lng": float(p["lng"]), "lat": float(p["lat"])},
                "speed": _speed_mps(p.get("speed"), default=2.0),
                "capture_capable": True,
            }
        )

    resources_available = portable_resources + normalized_personnel
    if not resources_available:
        result["errors"].append("No available resources (portable devices or personnel)")
        return result

    # 8. Build target trajectory for dispatch
    current_pos = traj_points[-1] if traj_points else fallback_pos
    if not current_pos:
        result["errors"].append("No suspect position available (empty trajectory and no alarm position)")
        return result
    dispatch_trajectory = [
        {"lng": current_pos["lng"], "lat": current_pos["lat"], "timestamp": 0},
    ]

    # Prefer best predicted candidate as second point
    if predicted_candidates:
        best = max(predicted_candidates, key=lambda c: c.get("probability") or 0)
        dispatch_trajectory.append(
            {
                "lng": float(best["x"]),
                "lat": float(best["y"]),
                "timestamp": float(best.get("timestamp") or 30),
            }
        )

    # 9. Dispatch
    try:
        dispatch_url = f"{WEITONG_BASE_URL}/dispatch/api/v1/dispatch/resource_allocation"
        dispatch_payload = {
            "resources_available": resources_available,
            "target_info": {
                "trajectory": dispatch_trajectory,
                "intent_classification": "escape",
            },
            "history_trajectory_data": {"trajectory": []},
            "rules": {
                "require_capture_unit": True,
                "capture_min_units": 1,
                "dispatch_mode": "two_point_split",
                "min_dispatch_units": 2,
                "max_drone_units": 1,
            },
            "prediction": {
                "modelName": "default",
                "params": {
                    "time_window": 60,
                    "confidence_threshold": 0.5,
                    "history_data_length": 100,
                    "prediction_interval": 5,
                },
            },
            "task_id": TASK_ID,
            "event_id": event_id,
            "coord_system": "lnglat",
            "sync_db": True,
        }
        dispatch_resp = post(dispatch_url, dispatch_payload, timeout=120)
        result["dispatch"] = dispatch_resp
    except Exception as exc:
        result["errors"].append(f"Dispatch failed: {exc}")
        return result

    # 10. Poll active allocation
    allocations = []
    for _round in range(MAX_POLL_ROUNDS):
        try:
            alloc_url = (
                f"{WEITONG_BASE_URL}/dispatch/api/v1/dispatch/allocation/active"
                f"?event_id={event_id}"
            )
            alloc_resp = get(alloc_url, timeout=30)
            if alloc_resp.get("code") == 200 and alloc_resp.get("data"):
                items = alloc_resp["data"].get("items") or []
                if items:
                    allocations = items
                    break
        except Exception as exc:
            result["warnings"].append(f"Poll allocation failed: {exc}")
        time.sleep(POLL_INTERVAL)

    result["allocation"] = allocations

    # Unified plan: prefer the rich active-allocation items (real patrol_resource
    # rows synced to DB), else fall back to the dispatch response's allocation_plan
    # (used when ids are not DB-backed, e.g. static resources).
    plan: list[dict] = []
    for a in allocations:
        plan.append(
            {
                "resourceId": a.get("resource_id"),
                "type": a.get("resource_type"),
                "etaSeconds": a.get("eta_seconds"),
                "targetLng": a.get("target_lng"),
                "targetLat": a.get("target_lat"),
                "action": a.get("action_type"),
            }
        )
    if not plan and isinstance(dispatch_resp, dict):
        id2type = {r["id"]: r["type"] for r in resources_available}

        def _valid_lnglat(lng, lat):
            return (
                lng is not None and lat is not None
                and -180 <= lng <= 180 and -90 <= lat <= 90
            )

        for a in (dispatch_resp.get("data") or {}).get("allocation_plan") or []:
            wps = a.get("path_waypoints") or []
            tgt = wps[-1] if wps else {}
            lng, lat = tgt.get("lng"), tgt.get("lat")
            if not _valid_lnglat(lng, lat):
                lng = lat = None  # guard against planner XY coords leaking through
            rid = a.get("resource_id")
            plan.append(
                {
                    "resourceId": rid,
                    "type": a.get("type") or id2type.get(str(rid)),
                    "etaSeconds": a.get("estimated_arrival_time"),
                    "targetLng": lng,
                    "targetLat": lat,
                    "action": a.get("action_type"),
                }
            )
    result["plan"] = plan

    # Determine feasibility
    capture_feasible = False
    if isinstance(dispatch_resp, dict):
        data = dispatch_resp.get("data") or dispatch_resp
        if data.get("capture_feasible"):
            capture_feasible = True
        elif dispatch_resp.get("msg") == "capture_not_feasible":
            capture_feasible = False
        elif dispatch_resp.get("code") == 422:
            capture_feasible = False
    if allocations:
        capture_feasible = True
    result["capture_feasible"] = capture_feasible

    return result


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def _read_json_file(path: str, label: str) -> str:
    """Read a UTF-8 JSON file and return its raw text.

    Lets callers pass --alarm-file / --personnel-file / --static-resources-file
    instead of inline JSON, avoiding shell quote-escaping issues on Windows.
    """
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return fh.read()
    except OSError as exc:
        print(json.dumps({"errors": [f"Cannot read {label} file '{path}': {exc}"]}, ensure_ascii=False))
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description="Alarm disposal orchestrator")
    parser.add_argument(
        "--alarm",
        required=False,
        help="Portable alarm JSON object (string). Optional when --event-id is given.",
    )
    parser.add_argument(
        "--alarm-file",
        default=None,
        help=(
            "Path to a UTF-8 file containing the alarm JSON object. Use this instead "
            "of --alarm to avoid shell quote escaping. Takes precedence over --alarm."
        ),
    )
    parser.add_argument(
        "--event-id",
        type=int,
        default=None,
        help=(
            "Reuse an existing suspect event instead of creating a new one. "
            "Re-runs prediction + dispatch against the current resource positions "
            "for a fresh point-in-time plan without producing a duplicate event."
        ),
    )
    parser.add_argument(
        "--personnel",
        default="[]",
        help="Patrol personnel JSON array (string)",
    )
    parser.add_argument(
        "--personnel-file",
        default=None,
        help=(
            "Path to a UTF-8 file containing the patrol personnel JSON array. Use this "
            "instead of --personnel to avoid shell quote escaping. Takes precedence over --personnel."
        ),
    )
    parser.add_argument(
        "--resource-source",
        choices=["portable", "simulator"],
        default="portable",
        help=(
            "Resource source. 'portable' (default) reads /home and auto-falls back "
            "to the simulator (DB+Redis) if unreachable; 'simulator' forces DB+Redis."
        ),
    )
    parser.add_argument(
        "--static-resources",
        default=None,
        help=(
            "JSON array of static resource points "
            '[{"id","type","lng","lat","speed"}] used directly as the dispatch '
            "resource list. Overrides --resource-source (no DB/Redis/portable access)."
        ),
    )
    parser.add_argument(
        "--static-resources-file",
        default=None,
        help=(
            "Path to a UTF-8 file containing the static resources JSON array. Use this "
            "instead of --static-resources to avoid shell quote escaping. Takes precedence."
        ),
    )
    parser.add_argument(
        "--keep-previous-allocations",
        action="store_true",
        help=(
            "When reusing --event-id, do NOT cancel the event's previous active "
            "allocations first. Default is to cancel them so the refreshed plan is clean."
        ),
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Print debug logs to stderr",
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        stream=sys.stderr,
    )

    if args.alarm_file is not None:
        alarm_raw = _read_json_file(args.alarm_file, "alarm")
    else:
        alarm_raw = args.alarm

    if alarm_raw is None and args.event_id is None:
        print(json.dumps({"errors": ["Either --alarm/--alarm-file or --event-id is required"]}, ensure_ascii=False))
        sys.exit(1)

    alarm = None
    if alarm_raw is not None:
        try:
            alarm = json.loads(alarm_raw)
        except json.JSONDecodeError as exc:
            logger.error("Invalid alarm JSON: %s", exc)
            print(json.dumps({"errors": [f"Invalid alarm JSON: {exc}"]}, ensure_ascii=False))
            sys.exit(1)

    personnel_raw = _read_json_file(args.personnel_file, "personnel") if args.personnel_file is not None else args.personnel
    try:
        personnel = json.loads(personnel_raw)
        if not isinstance(personnel, list):
            raise ValueError("personnel must be a JSON array")
    except (json.JSONDecodeError, ValueError) as exc:
        logger.error("Invalid personnel JSON: %s", exc)
        print(json.dumps({"errors": [f"Invalid personnel JSON: {exc}"]}, ensure_ascii=False))
        sys.exit(1)

    static_resources = None
    static_raw = None
    if args.static_resources_file is not None:
        static_raw = _read_json_file(args.static_resources_file, "static-resources")
    elif args.static_resources is not None:
        static_raw = args.static_resources
    if static_raw is not None:
        try:
            static_resources = json.loads(static_raw)
            if not isinstance(static_resources, list):
                raise ValueError("static-resources must be a JSON array")
        except (json.JSONDecodeError, ValueError) as exc:
            logger.error("Invalid static-resources JSON: %s", exc)
            print(json.dumps({"errors": [f"Invalid static-resources JSON: {exc}"]}, ensure_ascii=False))
            sys.exit(1)

    result = run(
        alarm,
        personnel,
        resource_source=args.resource_source,
        event_id=args.event_id,
        finish_previous=not args.keep_previous_allocations,
        static_resources=static_resources,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))

    if result.get("errors"):
        sys.exit(1)


if __name__ == "__main__":
    main()
