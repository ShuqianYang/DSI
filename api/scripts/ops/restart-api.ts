import { execSync } from "child_process";
import { spawn } from "child_process";
import * as net from "net";
import * as fs from "fs";

const API_DIR = "S:\\Projects\\projects_new\\api";
const LOG_FILE = `${API_DIR}\\api-dev.log`;
const PORT = 3001;

function findApiProcesses(): Array<{ pid: number; cmd: string }> {
  try {
    const output = execSync(
      `powershell -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and ($_.CommandLine -like '*api*index*' -or $_.CommandLine -like '*api*worker*' -or $_.CommandLine -like '*tsx*watch*api*') } | Select-Object ProcessId, CommandLine | ConvertTo-Csv -NoTypeInformation"`,
      { encoding: "utf-8", cwd: API_DIR }
    );
    const lines = output.trim().split("\n").slice(1); // skip header
    const processes: Array<{ pid: number; cmd: string }> = [];
    for (const line of lines) {
      const parts = line.split(",").map((s) => s.replace(/^"|"$/g, ""));
      if (parts.length >= 2 && parts[0]) {
        const pid = parseInt(parts[0], 10);
        if (!isNaN(pid)) {
          processes.push({ pid, cmd: parts[1] || "" });
        }
      }
    }
    return processes;
  } catch {
    return [];
  }
}

function killProcess(pid: number): boolean {
  try {
    execSync(`powershell -Command "Stop-Process -Id ${pid} -Force -ErrorAction Stop"`, {
      cwd: API_DIR,
    });
    return true;
  } catch {
    return false;
  }
}

function isPortListening(port: number): boolean {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(1000);
    socket.on("connect", () => {
      socket.end();
      resolve(true);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("error", () => resolve(false));
    socket.connect(port, "localhost");
  }) as Promise<boolean>;
}

async function main() {
  console.log("[Restart-API] Scanning for existing API processes...");
  const existing = findApiProcesses();

  if (existing.length > 0) {
    console.log(`[Restart-API] Found ${existing.length} API process(es):`);
    for (const p of existing) {
      console.log(`  PID ${p.pid}: ${p.cmd.slice(0, 80)}...`);
    }

    console.log("[Restart-API] Killing all existing processes...");
    for (const p of existing) {
      const ok = killProcess(p.pid);
      console.log(`  PID ${p.pid}: ${ok ? "killed" : "failed to kill"}`);
    }

    // Wait a moment for processes to fully exit
    await new Promise((r) => setTimeout(r, 1500));
  } else {
    console.log("[Restart-API] No existing API processes found.");
  }

  console.log(`[Restart-API] Starting API dev server (logs -> ${LOG_FILE})...`);
  const banner = `\n=== [Restart-API] ${new Date().toISOString()} session start ===\n`;
  fs.appendFileSync(LOG_FILE, banner);
  const outFd = fs.openSync(LOG_FILE, "a");
  const errFd = fs.openSync(LOG_FILE, "a");
  const child = spawn("pnpm", ["dev"], {
    cwd: API_DIR,
    detached: true,
    stdio: ["ignore", outFd, errFd],
    shell: true,
  });
  child.unref();

  // Wait for startup
  console.log("[Restart-API] Waiting for startup (5s)...");
  await new Promise((r) => setTimeout(r, 5000));

  // Verify
  const after = findApiProcesses();
  const listening = await isPortListening(PORT);

  console.log("\n[Restart-API] Verification:");
  console.log(`  API processes: ${after.length}`);
  for (const p of after) {
    console.log(`    PID ${p.pid}: ${p.cmd.slice(0, 60)}...`);
  }
  console.log(`  Port ${PORT} listening: ${listening ? "YES" : "NO"}`);

  if (after.length === 0) {
    console.error("[Restart-API] ERROR: No API process found after startup!");
    process.exit(1);
  }

  if (!listening) {
    console.error(`[Restart-API] WARNING: Port ${PORT} is not listening yet.`);
  }

  console.log("[Restart-API] Done.");
  process.exit(0);
}

main().catch((e) => {
  console.error("[Restart-API] Fatal error:", e);
  process.exit(1);
});
