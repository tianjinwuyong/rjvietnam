/**
 * watchdog.js -- Monitors and auto-restarts API server and Vite frontend
 * Usage: node watchdog.js  (Ctrl+C to stop)
 */
import { spawn, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import http from "node:http";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = __dirname;
const webDir = path.join(root, "apps", "web");
const viteBin = path.join(root, "node_modules", "vite", "bin", "vite.js");
const apiScript = path.join(root, "services", "api", "server.js");

const HEALTH_CHECK_INTERVAL = 15000;
const MAX_RESTART_DELAY = 30000;
const API_PORT = 8080;
const VITE_PORTS = [5178, 5179, 5180, 5181, 5182, 5183, 5184, 5185, 5186, 5187, 5188];

let apiProc = null;
let viteProc = null;
let viteActualPort = null;
let apiRestarts = 0, viteRestarts = 0;
let shuttingDown = false;
const WD_PID = process.pid;

function log(prefix, msg) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}] [${prefix}] ${msg}`);
}

function healthCheck(port) {
  return new Promise((resolve) => {
    if (!port) return resolve(false);
    const req = http.get(`http://127.0.0.1:${port}/health`, (res) => resolve(res.statusCode === 200));
    req.on("error", () => resolve(false));
    req.setTimeout(3000, () => { req.destroy(); resolve(false); });
  });
}

function findPidOnPort(port) {
  try {
    const out = execSync(`netstat -ano | findstr ":${port}" | findstr LISTENING`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const m = out.match(/LISTENING\s+(\d+)/);
    return m ? parseInt(m[1]) : null;
  } catch (_) { return null; }
}

function killPort(port) {
  const pid = findPidOnPort(port);
  if (pid && pid !== WD_PID) {
    try { execSync(`taskkill //F //PID ${pid}`, { stdio: "ignore" }); return true; } catch (_) {}
  }
  return false;
}

function killViteHard() {
  // Kill only processes on known Vite ports — never taskkill //IM (kills watchdog)
  for (const p of VITE_PORTS) killPort(p);
  viteProc = null;
  viteActualPort = null;
}

async function waitForApi(timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await healthCheck(API_PORT)) { log("API", `ready on :${API_PORT}`); return true; }
    await new Promise(r => setTimeout(r, 500));
  }
  log("API", `TIMEOUT after ${timeout}ms`);
  return false;
}

async function waitForVite(timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const p of VITE_PORTS) {
      if (await healthCheck(p)) {
        viteActualPort = p;
        log("VITE", `ready on :${p}`);
        return true;
      }
    }
    await new Promise(r => setTimeout(r, 500));
  }
  log("VITE", `TIMEOUT — no Vite found on ports ${VITE_PORTS.join(", ")}`);
  return false;
}

function calcBackoff(n) { return Math.min(1000 * 2 ** n, MAX_RESTART_DELAY); }

function startApi() {
  if (shuttingDown) return;
  log("API", "starting...");
  apiProc = spawn("node", [apiScript], { cwd: root, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env } });
  apiProc.stdout.on("data", d => process.stdout.write(`[api] ${d}`));
  apiProc.stderr.on("data", d => process.stderr.write(`[api:err] ${d}`));
  apiProc.on("exit", code => {
    if (shuttingDown) return;
    const delay = calcBackoff(apiRestarts);
    log("API", `crashed code=${code}, restarting in ${delay}ms (attempt ${apiRestarts + 1})`);
    apiRestarts++;
    setTimeout(startApi, delay);
  });
  apiProc.on("error", err => { if (!shuttingDown) log("API", `error: ${err.message}`); });
}

function startVite() {
  if (shuttingDown) return;
  killViteHard();
  log("VITE", "starting...");
  viteProc = spawn("node", [viteBin, "--host", "127.0.0.1"], {
    cwd: webDir, stdio: ["pipe", "pipe", "pipe"], shell: true,
    env: { ...process.env, HOST: "0.0.0.0", VITE_DEV_SERVER_HOST: "0.0.0.0" },
  });
  viteProc.stdout.on("data", d => process.stdout.write(`[vite] ${d}`));
  viteProc.stderr.on("data", d => process.stderr.write(`[vite:err] ${d}`));
  viteProc.on("exit", code => {
    if (shuttingDown) return;
    viteActualPort = null;
    const delay = calcBackoff(viteRestarts);
    log("VITE", `crashed code=${code}, restarting in ${delay}ms (attempt ${viteRestarts + 1})`);
    viteRestarts++;
    setTimeout(startVite, delay);
  });
  viteProc.on("error", err => { if (!shuttingDown) log("VITE", `error: ${err.message}`); });
}

async function healthMonitor() {
  while (!shuttingDown) {
    await new Promise(r => setTimeout(r, HEALTH_CHECK_INTERVAL));
    const apiOk = await healthCheck(API_PORT);

    // Discover Vite port dynamically if unknown
    if (!viteActualPort) {
      for (const p of VITE_PORTS) {
        if (await healthCheck(p)) { viteActualPort = p; break; }
      }
    }
    const viteOk = viteActualPort ? await healthCheck(viteActualPort) : false;

    if (!apiOk) {
      log("API", "unresponsive, restarting...");
      try { apiProc?.kill(); } catch (_) {}
      apiProc = null;
      apiRestarts++;
      setTimeout(startApi, calcBackoff(apiRestarts));
    }

    if (!viteOk) {
      log("VITE", `unresponsive on :${viteActualPort ?? "?"}, restarting...`);
      killViteHard();
      viteRestarts++;
      setTimeout(startVite, calcBackoff(viteRestarts));
    }

    if (apiOk && viteOk) {
      process.stdout.write(`[${new Date().toISOString().slice(11,23)}] [OK] api=up vite=:${viteActualPort} up\r`);
    }
  }
}

process.on("SIGINT", async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  log("WATCHDOG", "shutting down...");
  try { apiProc?.kill(); } catch (_) {}
  killViteHard();
  process.exit(0);
});

(async () => {
  log("WATCHDOG", "boot: starting API + Vite...");
  startApi();
  await waitForApi();
  startVite();
  await waitForVite();
  log("WATCHDOG", `all up -- monitoring every ${HEALTH_CHECK_INTERVAL / 1000}s`);
  log("WATCHDOG", `  API  -> http://127.0.0.1:${API_PORT}`);
  log("WATCHDOG", `  VITE -> http://127.0.0.1:${viteActualPort}`);
  healthMonitor();
})();
