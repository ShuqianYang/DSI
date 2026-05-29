import { cpSync, existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "cesium", "Build", "Cesium");
const dest = join(root, "public", "cesium");
const force = process.argv.includes("--force") || process.env.FORCE_COPY_CESIUM === "1";

if (!existsSync(src)) {
  console.warn("[copy-cesium] Skip: node_modules/cesium/Build/Cesium not found (run pnpm install).");
  process.exit(0);
}

if (!force && existsSync(join(dest, "Cesium.js"))) {
  console.log("[copy-cesium] Skip: public/cesium already exists (pnpm copy-cesium:force to overwrite).");
  process.exit(0);
}

mkdirSync(join(root, "public"), { recursive: true });
cpSync(src, dest, { recursive: true });
console.log("[copy-cesium] Synced to public/cesium");

const geoDestDir = join(root, "public", "geo");
function syncGeoAsset(fileName) {
  const src = join(root, fileName);
  const dest = join(geoDestDir, fileName);
  if (existsSync(src) && (force || !existsSync(dest))) {
    mkdirSync(geoDestDir, { recursive: true });
    cpSync(src, dest);
    console.log(`[copy-cesium] Synced ${fileName} -> public/geo/`);
  }
}
syncGeoAsset("china.geojson");
syncGeoAsset("eastern_china_sea.geojson");
