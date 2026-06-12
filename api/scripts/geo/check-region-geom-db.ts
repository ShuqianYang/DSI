import "dotenv/config";
import { Pool } from "pg";

const GEO_DATABASE_URL = process.env.GEO_DATABASE_URL;
const SCHEMA = "region_geom";

const REQUIRED_TABLES = [
  "amazon",
  "china_board",
  "china_city",
  "china_province",
  "china_town",
  "chinabasin",
  "custom_region",
  "custom_region_copy1",
  "hexicorridor",
  "international",
  "international_copt",
  "rivers",
  "sea_geom",
  "taiwan",
] as const;

const MIN_COUNTS: Record<string, number> = {
  china_province: 34,
  china_city: 370,
  china_town: 2900,
  taiwan: 42,
  custom_region: 34,
  international: 250,
};

const V1_SOURCES = [
  "china_province",
  "china_city",
  "china_town",
  "taiwan",
  "custom_region",
  "sea_geom",
  "international",
] as const;

if (!GEO_DATABASE_URL) {
  throw new Error("GEO_DATABASE_URL is required.");
}

const pool = new Pool({ connectionString: GEO_DATABASE_URL });

function assertCondition(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

try {
  const schemaResult = await pool.query(
    "SELECT 1 FROM information_schema.schemata WHERE schema_name = $1",
    [SCHEMA],
  );
  assertCondition(schemaResult.rowCount === 1, `Missing schema: ${SCHEMA}`);

  const tableResult = await pool.query<{
    table_name: string;
    row_count: string;
  }>(
    `
    SELECT c.relname AS table_name, c.reltuples::bigint::text AS row_count
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = $1
      AND c.relkind = 'r'
      AND c.relname = ANY($2::text[])
    ORDER BY c.relname;
    `,
    [SCHEMA, REQUIRED_TABLES],
  );
  const presentTables = new Set(tableResult.rows.map((row) => row.table_name));
  for (const table of REQUIRED_TABLES) {
    assertCondition(presentTables.has(table), `Missing table: ${SCHEMA}.${table}`);
  }

  const countRows = await Promise.all(
    REQUIRED_TABLES.map(async (table) => {
      const result = await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${SCHEMA}.${table}`);
      return { table, count: Number(result.rows[0]?.count ?? 0) };
    }),
  );

  for (const [table, min] of Object.entries(MIN_COUNTS)) {
    const count = countRows.find((row) => row.table === table)?.count ?? 0;
    assertCondition(count >= min, `${SCHEMA}.${table} row count ${count} is below expected minimum ${min}`);
  }

  const geometryRows = await pool.query<{
    f_table_name: string;
    f_geometry_column: string;
    type: string;
    srid: number;
  }>(
    `
    SELECT f_table_name, f_geometry_column, type, srid
    FROM geometry_columns
    WHERE f_table_schema = $1
    ORDER BY f_table_name;
    `,
    [SCHEMA],
  );
  const geometryTables = new Set(geometryRows.rows.map((row) => row.f_table_name));
  for (const table of REQUIRED_TABLES) {
    assertCondition(geometryTables.has(table), `Missing geometry metadata for ${SCHEMA}.${table}`);
  }

  const normalizedRows = await Promise.all(
    V1_SOURCES.map(async (table) => {
      const result = await pool.query<{
        row_count: string;
        null_geom_count: string;
        normalized_srid_count: string;
        invalid_count: string;
      }>(
        `
        SELECT
          count(*)::text AS row_count,
          count(*) FILTER (WHERE geom IS NULL)::text AS null_geom_count,
          count(*) FILTER (
            WHERE ST_SRID(CASE WHEN ST_SRID(geom) = 0 THEN ST_SetSRID(geom, 4326) ELSE ST_Transform(geom, 4326) END) = 4326
          )::text AS normalized_srid_count,
          count(*) FILTER (
            WHERE geom IS NOT NULL
              AND NOT ST_IsValid(CASE WHEN ST_SRID(geom) = 0 THEN ST_SetSRID(geom, 4326) ELSE ST_Transform(geom, 4326) END)
          )::text AS invalid_count
        FROM ${SCHEMA}.${table};
        `,
      );
      return {
        table,
        rowCount: Number(result.rows[0]?.row_count ?? 0),
        nullGeomCount: Number(result.rows[0]?.null_geom_count ?? 0),
        normalizedSridCount: Number(result.rows[0]?.normalized_srid_count ?? 0),
        invalidCount: Number(result.rows[0]?.invalid_count ?? 0),
      };
    }),
  );

  for (const row of normalizedRows) {
    assertCondition(row.nullGeomCount === 0, `${SCHEMA}.${row.table} has ${row.nullGeomCount} null geom rows`);
    assertCondition(
      row.normalizedSridCount === row.rowCount,
      `${SCHEMA}.${row.table} has rows that cannot normalize to SRID 4326`,
    );
    assertCondition(row.invalidCount === 0, `${SCHEMA}.${row.table} has ${row.invalidCount} invalid geometries`);
  }

  const taiwanStrait = await pool.query<{
    id: number;
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
    SELECT
      id,
      region_cn,
      region_en,
      level,
      ST_SRID(geom) AS srid,
      GeometryType(geom) AS geometry_type,
      ST_XMin(ST_Envelope(geom)) AS bbox_west,
      ST_XMax(ST_Envelope(geom)) AS bbox_east,
      ST_YMin(ST_Envelope(geom)) AS bbox_south,
      ST_YMax(ST_Envelope(geom)) AS bbox_north
    FROM ${SCHEMA}.custom_region
    WHERE region_cn = '台湾海峡' AND region_en = 'Taiwan Strait' AND level = 'strait'
    ORDER BY id
    LIMIT 1;
    `,
  );
  assertCondition(taiwanStrait.rowCount === 1, "Missing custom_region Taiwan Strait curated geometry");

  console.log(
    JSON.stringify(
      {
        ok: true,
        schema: SCHEMA,
        counts: countRows,
        geometryColumns: geometryRows.rows,
        normalizedSources: normalizedRows,
        taiwanStrait: taiwanStrait.rows[0],
      },
      null,
      2,
    ),
  );
} finally {
  await pool.end();
}
