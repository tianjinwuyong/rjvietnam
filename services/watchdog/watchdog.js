/**
 * SMT Factory Watchdog Service
 * Keeps all dev servers running with auto-restart on crash
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const isWin = process.platform === "win32";
const rootDir = dirname(fileURLToPath(import.meta.url));
// Project root = smt-factory-system/ (2 levels up from services/watchdog/)
const projectRoot = join(rootDir, "..", "..");

const services = [
  { name: "api",     port: 8080, exe: "node",    args: ["services/api/server.js"],                        cwd: projectRoot },
  { name: "web",     port: 5178, exe: "npx",     args: ["vite", "--port", "5178"],                         cwd: projectRoot },
  { name: "scanner", port: 5174, exe: "npx",     args: ["vite", "--port", "5174"],                         cwd: join(projectRoot, "apps/pdas/scanner-terminal") },
  { name: "display", port: 5175, exe: "npx",     args: ["vite", "--port", "5175"],                         cwd: join(projectRoot, "apps/display-board") },
];

const children = new Map();

function log(level, msg) {
  const ts = new Date().toISOString().slice(11, 19);
  const out = level === "err" ? console.error : console.log;
  out(`[${ts}] [${level.toUpperCase()}] ${msg}`);
}

function startService(svc) {
  const prev = children.get(svc.name);
  if (prev?.proc && !prev.proc.killed && prev.proc.exitCode == null) return;

  if (isWin) {
    startServiceWin(svc, prev);
  } else {
    startServiceUnix(svc, prev);
  }
}

function winExe(exe) {
  // On Windows, cmd scripts (.cmd/.bat) must be spawned via cmd.exe /c
  // Return null to signal: use cmd /c wrapper below
  if (isWin && (exe === "npx" || exe === "npm")) return null;
  return exe;
}

function startServiceWin(svc, prev) {
  const env = { ...process.env, PGPASSWORD: process.env.PGPASSWORD ?? "postgres" };
  const exe = winExe(svc.exe);
  let child;
  if (exe === null) {
    // cmd.exe /c for npm/npx batch scripts
    child = spawn("cmd", ["/c", svc.exe + ".cmd", ...svc.args], {
      cwd: svc.cwd,
      stdio: "pipe",
      windowsHide: true,
      env,
    });
  } else {
    child = spawn(exe, svc.args, {
      cwd: svc.cwd,
      stdio: "pipe",
      windowsHide: true,
      env,
    });
  }
  const entry = { proc: child, restarts: prev?.restarts ?? 0, lastStart: Date.now() };
  children.set(svc.name, entry);

  child.stdout?.on("data", d => process.stdout.write(`[${svc.name}] ${d}`));
  child.stderr?.on("data", d => process.stderr.write(`[${svc.name}] ${d}`));

  child.on("exit", (code, sig) => {
    if (code === null && sig === "SIGINT") return;
    entry.restarts++;
    const elapsed = ((Date.now() - entry.lastStart) / 1000).toFixed(1);
    log("warn", `${svc.name} crashed (code=${code}) — restarting in 3s (uptime: ${elapsed}s, restarts: ${entry.restarts})`);
    setTimeout(() => startService(svc), 3000);
  });

  log("info", `${svc.name} started (http://localhost:${svc.port}, pid=${child.pid})`);
}

function startServiceUnix(svc, prev) {
  const child = spawn(svc.exe, svc.args, {
    cwd: svc.cwd,
    stdio: "pipe",
    env: { ...process.env, FORCE_COLOR: "1" },
  });
  const entry = { proc: child, restarts: prev?.restarts ?? 0, lastStart: Date.now() };
  children.set(svc.name, entry);

  child.stdout?.on("data", d => process.stdout.write(`[${svc.name}] ${d}`));
  child.stderr?.on("data", d => process.stderr.write(`[${svc.name}] ${d}`));

  child.on("exit", (code, sig) => {
    if (code === null && sig === "SIGINT") return;
    entry.restarts++;
    const elapsed = ((Date.now() - entry.lastStart) / 1000).toFixed(1);
    log("warn", `${svc.name} crashed (code=${code}) — restarting in 3s (uptime: ${elapsed}s, restarts: ${entry.restarts})`);
    setTimeout(() => startService(svc), 3000);
  });

  log("info", `${svc.name} started (http://localhost:${svc.port}, pid=${child.pid})`);
}

function stopAll() {
  log("info", "Watchdog shutting down...");
  for (const [name, { proc }] of children) {
    try { proc.kill("SIGINT"); } catch {}
  }
  process.exit(0);
}

process.on("SIGINT",  stopAll);
process.on("SIGTERM", stopAll);

services.forEach((svc, i) => setTimeout(() => startService(svc), i * 1500));

log("info", `Watchdog active — managing ${services.length} services`);
log("info", `API:      http://localhost:8080`);
log("info", `Web:      http://localhost:5178`);
log("info", `Scanner:  http://localhost:5174`);
log("info", "Press Ctrl+C to stop all services");

setInterval(() => {
  const alive = [...children.entries()].filter(([, v]) => !v.proc.killed && v.proc.exitCode == null);
  log("info", `Health: ${alive.length}/${services.length} services alive`);
}, 60000);
