import { Pool } from "pg";

let geoPool: Pool | undefined;

export function getGeoDatabasePool(): Pool {
  const connectionString = process.env.GEO_DATABASE_URL;
  if (!connectionString) {
    throw new Error("GEO_DATABASE_URL is required for PostGIS region lookup.");
  }
  geoPool ??= new Pool({ connectionString });
  return geoPool;
}

export async function closeGeoDatabasePool(): Promise<void> {
  if (!geoPool) return;
  const pool = geoPool;
  geoPool = undefined;
  await pool.end();
}
