import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function syncDir(srcDir, destDir) {
  if (!existsSync(srcDir)) {
    console.warn(`[copy-fallback-images] Skip: ${srcDir} not found.`);
    return;
  }

  mkdirSync(destDir, { recursive: true });

  for (const entry of readdirSync(srcDir)) {
    const src = join(srcDir, entry);
    const dest = join(destDir, entry);
    const stat = statSync(src);

    if (stat.isDirectory()) {
      syncDir(src, dest);
      continue;
    }

    cpSync(src, dest, { force: true });
  }

  console.log(`[copy-fallback-images] Synced ${srcDir} -> ${destDir}`);
}

syncDir(join(root, "api", "public", "local-tiles"), join(root, "public", "local-tiles"));
syncDir(join(root, "api", "public", "satellite"), join(root, "public", "satellite"));
