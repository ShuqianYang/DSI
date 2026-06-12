import "dotenv/config";
import { Pool } from "pg";

const GEO_DATABASE_URL = process.env.GEO_DATABASE_URL;
const SCHEMA = "region_geom";
const CATALOG = "region_resolve_catalog";

if (!GEO_DATABASE_URL) {
  throw new Error("GEO_DATABASE_URL is required.");
}

const pool = new Pool({ connectionString: GEO_DATABASE_URL });

const normalizeGeomSql = (column = "geom") =>
  `CASE WHEN ST_SRID(${column}) = 0 THEN ST_SetSRID(${column}, 4326) ELSE ST_Transform(${column}, 4326) END`;

function assertCondition(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

try {
  await pool.query("BEGIN");
  await pool.query(`DROP MATERIALIZED VIEW IF EXISTS ${SCHEMA}.${CATALOG};`);
  await pool.query(`
    CREATE MATERIALIZED VIEW ${SCHEMA}.${CATALOG} AS
    SELECT
      'china_province'::text AS source_table,
      COALESCE(gid::text, adcode::text) AS source_id,
      COALESCE(adcode::text, gid::text) AS stable_id,
      name::text AS name,
      NULL::text AS name_en,
      COALESCE(level, 'province')::text AS level,
      parent::text AS parent_id,
      ARRAY(
        SELECT DISTINCT alias
        FROM unnest(ARRAY[
          name::text,
          regexp_replace(name::text, '(壮族自治区|回族自治区|维吾尔自治区|特别行政区|自治区|省|市)$', '')
        ]::text[]) AS alias
        WHERE alias IS NOT NULL AND btrim(alias) <> ''
      ) AS aliases,
      ${normalizeGeomSql()} AS geom
    FROM ${SCHEMA}.china_province

    UNION ALL

    SELECT
      'china_city'::text,
      COALESCE(gid::text, adcode::text),
      COALESCE(adcode::text, gid::text),
      name::text,
      NULL::text,
      COALESCE(level, 'city')::text,
      parent::text,
      ARRAY(
        SELECT DISTINCT alias
        FROM unnest(ARRAY[
          name::text,
          regexp_replace(name::text, '(自治州|地区|盟|市)$', '')
        ]::text[]) AS alias
        WHERE alias IS NOT NULL AND btrim(alias) <> ''
      ),
      ${normalizeGeomSql()}
    FROM ${SCHEMA}.china_city

    UNION ALL

    SELECT
      'china_town'::text,
      COALESCE(gid::text, adcode::text),
      COALESCE(adcode::text, gid::text),
      name::text,
      NULL::text,
      COALESCE(level, 'district')::text,
      parent::text,
      ARRAY(
        SELECT DISTINCT alias
        FROM unnest(ARRAY[
          name::text,
          regexp_replace(name::text, '(自治县|区|县|市|旗)$', '')
        ]::text[]) AS alias
        WHERE alias IS NOT NULL AND btrim(alias) <> ''
      ),
      ${normalizeGeomSql()}
    FROM ${SCHEMA}.china_town

    UNION ALL

    SELECT
      'taiwan'::text,
      gid::text,
      gid::text,
      name::text,
      NULL::text,
      'taiwan_admin'::text,
      NULL::text,
      ARRAY(
        SELECT DISTINCT alias
        FROM unnest(ARRAY[
          name::text,
          regexp_replace(name::text, '(市|县)$', '')
        ]::text[]) AS alias
        WHERE alias IS NOT NULL AND btrim(alias) <> ''
      ),
      ${normalizeGeomSql()}
    FROM ${SCHEMA}.taiwan

    UNION ALL

    SELECT
      'custom_region'::text,
      id::text,
      id::text,
      region_cn::text,
      region_en::text,
      COALESCE(level, 'custom')::text,
      NULL::text,
      ARRAY(
        SELECT DISTINCT alias
        FROM unnest(ARRAY[region_cn::text, region_en::text]::text[]) AS alias
        WHERE alias IS NOT NULL AND btrim(alias) <> ''
      ),
      ${normalizeGeomSql()}
    FROM ${SCHEMA}.custom_region

    UNION ALL

    SELECT
      'sea_geom'::text,
      id::text,
      id::text,
      country_cn::text,
      country_en::text,
      'sea'::text,
      NULL::text,
      ARRAY(
        SELECT DISTINCT alias
        FROM unnest(ARRAY[country_cn::text, country_en::text]::text[]) AS alias
        WHERE alias IS NOT NULL AND btrim(alias) <> ''
      ),
      ${normalizeGeomSql()}
    FROM ${SCHEMA}.sea_geom

    UNION ALL

    SELECT
      'international'::text,
      id::text,
      id::text,
      country_cn::text,
      country_en::text,
      CASE
        WHEN level IS NULL OR btrim(level) = '' OR lower(level) IN ('intertnational', 'international')
          THEN 'country'
        ELSE level
      END::text,
      NULL::text,
      ARRAY(
        SELECT DISTINCT alias
        FROM unnest(ARRAY[
          country_cn::text,
          country_en::text,
          region_cn::text,
          region_en::text,
          continent_cn::text,
          continent_en::text,
          capital_cn::text,
          capital_en::text
        ]::text[]) AS alias
        WHERE alias IS NOT NULL AND btrim(alias) <> ''
      ),
      ${normalizeGeomSql()}
    FROM ${SCHEMA}.international;
  `);

  await pool.query(`CREATE INDEX ${CATALOG}_geom_gix ON ${SCHEMA}.${CATALOG} USING GIST (geom);`);
  await pool.query(`CREATE INDEX ${CATALOG}_name_idx ON ${SCHEMA}.${CATALOG} (name);`);
  await pool.query(`CREATE INDEX ${CATALOG}_level_idx ON ${SCHEMA}.${CATALOG} (level);`);
  await pool.query(`CREATE INDEX ${CATALOG}_aliases_gin ON ${SCHEMA}.${CATALOG} USING GIN (aliases);`);
  await pool.query(`CREATE INDEX ${CATALOG}_source_idx ON ${SCHEMA}.${CATALOG} (source_table, source_id, stable_id);`);
  await pool.query(`ANALYZE ${SCHEMA}.${CATALOG};`);
  await pool.query("COMMIT");

  const summary = await pool.query<{
    row_count: string;
    null_geom_count: string;
    srid_count: string;
    invalid_count: string;
  }>(`
    SELECT
      count(*)::text AS row_count,
      count(*) FILTER (WHERE geom IS NULL)::text AS null_geom_count,
      count(*) FILTER (WHERE ST_SRID(geom) = 4326)::text AS srid_count,
      count(*) FILTER (WHERE geom IS NOT NULL AND NOT ST_IsValid(geom))::text AS invalid_count
    FROM ${SCHEMA}.${CATALOG};
  `);

  const bySource = await pool.query<{ source_table: string; count: string }>(`
    SELECT source_table, count(*)::text AS count
    FROM ${SCHEMA}.${CATALOG}
    GROUP BY source_table
    ORDER BY source_table;
  `);

  const taiwanStrait = await pool.query<{
    source_table: string;
    source_id: string;
    stable_id: string;
    name: string;
    name_en: string;
    level: string;
    bbox_west: number;
    bbox_east: number;
    bbox_south: number;
    bbox_north: number;
    center_lon: number;
    center_lat: number;
    geometry_type: string;
  }>(`
    SELECT
      source_table,
      source_id,
      stable_id,
      name,
      name_en,
      level,
      ST_XMin(ST_Envelope(geom)) AS bbox_west,
      ST_XMax(ST_Envelope(geom)) AS bbox_east,
      ST_YMin(ST_Envelope(geom)) AS bbox_south,
      ST_YMax(ST_Envelope(geom)) AS bbox_north,
      ST_X(ST_PointOnSurface(geom)) AS center_lon,
      ST_Y(ST_PointOnSurface(geom)) AS center_lat,
      GeometryType(geom) AS geometry_type
    FROM ${SCHEMA}.${CATALOG}
    WHERE name = '台湾海峡' OR '台湾海峡' = ANY(aliases)
    ORDER BY CASE WHEN name = '台湾海峡' THEN 0 ELSE 1 END
    LIMIT 1;
  `);

  const summaryRow = summary.rows[0];
  assertCondition(summaryRow, "Missing catalog summary row.");
  const rowCount = Number(summaryRow.row_count);
  const nullGeomCount = Number(summaryRow.null_geom_count);
  const sridCount = Number(summaryRow.srid_count);
  const invalidCount = Number(summaryRow.invalid_count);

  assertCondition(rowCount >= 3650, `${SCHEMA}.${CATALOG} row count ${rowCount} is below expected minimum 3650.`);
  assertCondition(nullGeomCount === 0, `${SCHEMA}.${CATALOG} has ${nullGeomCount} null geom rows.`);
  assertCondition(sridCount === rowCount, `${SCHEMA}.${CATALOG} has non-4326 geometry rows.`);
  assertCondition(invalidCount === 0, `${SCHEMA}.${CATALOG} has ${invalidCount} invalid geometry rows.`);
  assertCondition(taiwanStrait.rowCount === 1, `${SCHEMA}.${CATALOG} did not resolve Taiwan Strait.`);
  assertCondition(
    taiwanStrait.rows[0]?.source_table === "custom_region" && taiwanStrait.rows[0]?.level === "strait",
    "Taiwan Strait catalog row should come from custom_region with level=strait.",
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        catalog: `${SCHEMA}.${CATALOG}`,
        summary: {
          rowCount,
          nullGeomCount,
          sridCount,
          invalidCount,
        },
        bySource: bySource.rows.map((row) => ({
          sourceTable: row.source_table,
          count: Number(row.count),
        })),
        taiwanStrait: taiwanStrait.rows[0],
      },
      null,
      2,
    ),
  );
} catch (error) {
  await pool.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await pool.end();
}
