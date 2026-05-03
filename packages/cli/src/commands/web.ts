import { defineCommand } from "citty";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, openSync } from "node:fs";
import { join } from "node:path";
import { userConfig } from "@crux/core";

const { resolveCruxHome } = userConfig;

function resolvePluginRoot(): string {
  if (process.env.CRUX_PLUGIN_ROOT) return process.env.CRUX_PLUGIN_ROOT;
  return new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
}

function pidPath() {
  return join(resolveCruxHome(), "web.pid");
}
function logPath() {
  return join(resolveCruxHome(), "web.log");
}

function readPid(): number | null {
  try {
    return parseInt(readFileSync(pidPath(), "utf8").trim(), 10);
  } catch {
    return null;
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killPort3210(): void {
  try {
    const result = Bun.spawnSync(["lsof", "-ti", ":3210"]);
    const pids = new TextDecoder().decode(result.stdout).trim().split("\n").filter(Boolean);
    for (const p of pids) {
      try {
        process.kill(parseInt(p, 10), 9);
      } catch {}
    }
  } catch {}
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  spawn(cmd, [url], { detached: true, stdio: "ignore" }).unref();
}

async function waitReady(timeoutMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch("http://localhost:3210", { signal: AbortSignal.timeout(500) });
      if (res.status < 500) return true;
    } catch {}
    await Bun.sleep(500);
  }
  return false;
}

const startCmd = defineCommand({
  meta: { name: "start", description: "Start the Crux web server." },
  async run() {
    const pluginRoot = resolvePluginRoot();
    const webDir = join(pluginRoot, "apps/web");

    if (!existsSync(join(webDir, "node_modules"))) {
      console.error("Installing web dependencies...");
      Bun.spawnSync(["bun", "install"], {
        cwd: pluginRoot,
        stdio: ["ignore", "inherit", "inherit"],
      });
    }

    killPort3210();

    mkdirSync(resolveCruxHome(), { recursive: true });
    const logFd = openSync(logPath(), "a");

    const proc = spawn("bun", ["run", "dev"], {
      cwd: webDir,
      env: { ...process.env, CRUX_HOME: resolveCruxHome() },
      detached: true,
      stdio: ["ignore", logFd, logFd],
    });
    proc.unref();

    writeFileSync(pidPath(), String(proc.pid));

    process.stdout.write("Starting web server");
    const ready = await waitReady();
    process.stdout.write("\n");

    if (!ready) {
      console.error("Server did not become ready within 30s. Check: crux web status");
      process.exit(1);
    }

    console.log("Web server running at http://localhost:3210");
    openBrowser("http://localhost:3210");
  },
});

const stopCmd = defineCommand({
  meta: { name: "stop", description: "Stop the Crux web server." },
  run() {
    const pid = readPid();
    if (!pid || !isAlive(pid)) {
      console.log("not running");
      return;
    }
    try {
      process.kill(pid, 9);
    } catch {}
    killPort3210();
    try {
      Bun.unlinkSync(pidPath());
    } catch {}
    console.log("stopped");
  },
});

const statusCmd = defineCommand({
  meta: { name: "status", description: "Show web server status." },
  run() {
    const pid = readPid();
    const alive = pid ? isAlive(pid) : false;

    if (alive) {
      console.log(`running  pid=${pid}  http://localhost:3210`);
    } else {
      console.log("not running");
    }

    const lp = logPath();
    if (existsSync(lp)) {
      const lines = readFileSync(lp, "utf8").split("\n").filter(Boolean).slice(-20);
      if (lines.length) {
        console.log("\n--- last log lines ---");
        console.log(lines.join("\n"));
      }
    }
  },
});

export const webCommand = defineCommand({
  meta: { name: "web", description: "Manage the Crux web server." },
  subCommands: { start: startCmd, stop: stopCmd, status: statusCmd },
});
