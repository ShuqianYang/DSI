#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Seed live resource positions into the server Redis for testing.

Reads the patrol_resource catalog from Postgres and writes a position for each
resource into Redis under `realtime:patrol_resource:{id}` (hash: lng/lat/updated_at),
exactly the key shape patrol_simulator/simulator.py and the dispatch service read.

This lets the orchestrate.py simulator fallback work without running the full
simulator loop. DB/Redis connection settings are reused from orchestrate.py
(same env vars as simulator.py).

Examples:
  # Scatter all resources around an alarm point, within 800m
  python seed_positions.py --near-lng 87.1564 --near-lat 43.8918 --radius-m 800

  # Spread resources along the border line (default when no --near point given)
  python seed_positions.py
"""

import argparse
import math
import sys
from datetime import datetime, timezone

import orchestrate  # reuse DB/Redis config + connection settings


# Default border line (matches CAMERAS / patrol boundary at lng 87.1564)
BORDER_LNG = 87.1564
BORDER_LAT_MIN = 43.8776
BORDER_LAT_MAX = 43.9219


def _meters_to_deg(dx_m: float, dy_m: float, lat: float) -> tuple[float, float]:
    """Convert a metric offset (east=dx, north=dy) to (dlng, dlat) degrees."""
    dlat = dy_m / 111320.0
    dlng = dx_m / (111320.0 * math.cos(math.radians(lat)))
    return dlng, dlat


def load_catalog() -> list[dict]:
    import psycopg2

    conn = psycopg2.connect(
        host=orchestrate.DB_HOST, port=orchestrate.DB_PORT, dbname=orchestrate.DB_NAME,
        user=orchestrate.DB_USER, password=orchestrate.DB_PASSWORD, connect_timeout=8,
    )
    try:
        cur = conn.cursor()
        cur.execute("SELECT id, type, speed FROM patrol_resource ORDER BY id")
        rows = [{"id": r[0], "type": r[1], "speed": float(r[2] or 0)} for r in cur.fetchall()]
        cur.close()
        return rows
    finally:
        conn.close()


def positions_near(catalog: list[dict], lng: float, lat: float, radius_m: float) -> dict[int, tuple]:
    """Evenly fill a disk of radius_m around (lng, lat) using a sunflower spread."""
    out = {}
    n = max(len(catalog), 1)
    golden = math.pi * (3.0 - math.sqrt(5.0))
    for i, res in enumerate(catalog):
        r = radius_m * math.sqrt((i + 0.5) / n)
        theta = i * golden
        dx = r * math.cos(theta)
        dy = r * math.sin(theta)
        dlng, dlat = _meters_to_deg(dx, dy, lat)
        out[res["id"]] = (round(lng + dlng, 7), round(lat + dlat, 7))
    return out


def positions_along_border(catalog: list[dict]) -> dict[int, tuple]:
    """Spread resources evenly along the border line with small lateral offset."""
    out = {}
    n = max(len(catalog), 1)
    for i, res in enumerate(catalog):
        frac = (i + 0.5) / n
        lat = BORDER_LAT_MIN + (BORDER_LAT_MAX - BORDER_LAT_MIN) * frac
        # small east/west offset so points are not perfectly collinear
        dlng, _ = _meters_to_deg((-1 if i % 2 else 1) * 60.0, 0.0, lat)
        out[res["id"]] = (round(BORDER_LNG + dlng, 7), round(lat, 7))
    return out


def write_to_redis(positions: dict[int, tuple], ttl: int = 3600) -> int:
    import redis
    client = redis.Redis(
        host=orchestrate.REDIS_HOST, port=orchestrate.REDIS_PORT, db=orchestrate.REDIS_DB,
        password=orchestrate.REDIS_PASSWORD, decode_responses=True, socket_timeout=5,
    )
    client.ping()
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    written = 0
    with client.pipeline() as pipe:
        for rid, (lng, lat) in positions.items():
            key = f"realtime:patrol_resource:{rid}"
            pipe.hset(key, mapping={"lng": str(lng), "lat": str(lat), "updated_at": ts})
            pipe.expire(key, ttl)
            written += 1
        pipe.execute()
    return written


def cleanup_redis() -> int:
    """Delete all realtime:patrol_resource:* keys (the seeded live positions)."""
    import redis

    client = redis.Redis(
        host=orchestrate.REDIS_HOST, port=orchestrate.REDIS_PORT, db=orchestrate.REDIS_DB,
        password=orchestrate.REDIS_PASSWORD, decode_responses=True, socket_timeout=5,
    )
    client.ping()
    keys = list(client.scan_iter("realtime:patrol_resource:*"))
    if not keys:
        return 0
    return client.delete(*keys)


def main():
    parser = argparse.ArgumentParser(description="Seed patrol_resource live positions into Redis")
    parser.add_argument("--near-lng", type=float, help="Cluster resources around this longitude")
    parser.add_argument("--near-lat", type=float, help="Cluster resources around this latitude")
    parser.add_argument("--radius-m", type=float, default=800.0, help="Cluster radius in meters (with --near)")
    parser.add_argument("--ttl", type=int, default=3600, help="Redis key TTL in seconds")
    parser.add_argument("--dry-run", action="store_true", help="Print positions without writing to Redis")
    parser.add_argument(
        "--cleanup",
        action="store_true",
        help="Delete all realtime:patrol_resource:* keys from Redis and exit",
    )
    args = parser.parse_args()

    if args.cleanup:
        deleted = cleanup_redis()
        print(f"Deleted {deleted} realtime:patrol_resource:* keys from Redis "
              f"{orchestrate.REDIS_HOST}:{orchestrate.REDIS_PORT}.")
        return

    catalog = load_catalog()
    if not catalog:
        print("No patrol_resource rows found; nothing to seed.")
        sys.exit(1)

    if args.near_lng is not None and args.near_lat is not None:
        positions = positions_near(catalog, args.near_lng, args.near_lat, args.radius_m)
        mode = f"near ({args.near_lng}, {args.near_lat}) r={args.radius_m}m"
    else:
        positions = positions_along_border(catalog)
        mode = "along border line"

    print(f"Seeding {len(positions)} resources [{mode}] -> Redis {orchestrate.REDIS_HOST}:{orchestrate.REDIS_PORT}")
    by_id = {c["id"]: c for c in catalog}
    for rid, (lng, lat) in list(positions.items())[:8]:
        print(f"  {rid} {by_id[rid]['type']}: ({lng}, {lat})")
    if len(positions) > 8:
        print(f"  ... and {len(positions) - 8} more")

    if args.dry_run:
        print("Dry run: nothing written.")
        return

    written = write_to_redis(positions, ttl=args.ttl)
    print(f"Wrote {written} keys to Redis (TTL {args.ttl}s).")


if __name__ == "__main__":
    main()
