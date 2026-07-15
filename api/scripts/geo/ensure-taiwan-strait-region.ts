import "dotenv/config";
import { Pool } from "pg";

const GEO_DATABASE_URL = process.env.GEO_DATABASE_URL;
const REGION_CN = "台湾海峡";
const REGION_EN = "Taiwan Strait";
const LEVEL = "strait";
const NOTE =
  "curated_bbox_polygon; approximate Taiwan Strait geometry for RegionResolve Phase0; replace with authoritative polygon when available";
const WKT = "POLYGON((117 22, 122.5 22, 122.5 26.5, 117 26.5, 117 22))";

if (!GEO_DATABASE_URL) {
  throw new Error("GEO_DATABASE_URL is required.");
}

const pool = new Pool({ connectionString: GEO_DATABASE_URL });

try {
  const result = await pool.query<{
    id: number;
    action: "inserted" | "updated";
    region_cn: string;
    region_en: string;
    level: string;
    srid: number;
    geometry_type: string;
    bbox_west: number;
    bbox_east: number;
    bbox_south: number;
    bbox_north: number;
  }>(
    `
    WITH existing AS (
      SELECT ctid, id
      FROM region_geom.custom_region
      WHERE region_cn = $1 OR region_en = $2
      ORDER BY CASE WHEN region_cn = $1 THEN 0 ELSE 1 END, id
      LIMIT 1
    ),
    existing_duplicate AS (
      SELECT EXISTS (
        SELECT 1
        FROM existing e
        JOIN region_geom.custom_region r ON r.id = e.id
        GROUP BY e.id
        HAVING count(*) > 1
      ) AS has_duplicate
    ),
    target AS (
      SELECT
        CASE
          WHEN EXISTS (SELECT 1 FROM existing)
            AND NOT (SELECT has_duplicate FROM existing_duplicate)
          THEN (SELECT id FROM existing)
          ELSE (
            SELECT COALESCE(max(id), 0) + 1
            FROM region_geom.custom_region
            WHERE region_cn IS DISTINCT FROM $1
              AND region_en IS DISTINCT FROM $2
          )
        END::smallint AS id
    ),
    updated AS (
      UPDATE region_geom.custom_region
      SET
        id = (SELECT id FROM target),
        region_cn = $1,
        region_en = $2,
        level = $3,
        note = $4,
        geom = ST_SetSRID(ST_GeomFromText($5), 4326)
      WHERE ctid = (SELECT ctid FROM existing)
      RETURNING id, 'updated'::text AS action, region_cn, region_en, level, geom
    ),
    inserted AS (
      INSERT INTO region_geom.custom_region (id, region_cn, region_en, level, note, geom)
      SELECT (SELECT id FROM target), $1, $2, $3, $4, ST_SetSRID(ST_GeomFromText($5), 4326)
      WHERE NOT EXISTS (SELECT 1 FROM existing)
      RETURNING id, 'inserted'::text AS action, region_cn, region_en, level, geom
    ),
    changed AS (
      SELECT * FROM updated
      UNION ALL
      SELECT * FROM inserted
    )
    SELECT
      id,
      action,
      region_cn,
      region_en,
      level,
      ST_SRID(geom) AS srid,
      GeometryType(geom) AS geometry_type,
      ST_XMin(ST_Envelope(geom)) AS bbox_west,
      ST_XMax(ST_Envelope(geom)) AS bbox_east,
      ST_YMin(ST_Envelope(geom)) AS bbox_south,
      ST_YMax(ST_Envelope(geom)) AS bbox_north
    FROM changed;
    `,
    [REGION_CN, REGION_EN, LEVEL, NOTE, WKT],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error("Taiwan Strait region was not inserted or updated.");
  }

  console.log(JSON.stringify(row, null, 2));
} finally {
  await pool.end();
}
