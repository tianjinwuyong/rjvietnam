/**
 * Dev orchestration - runs the watchdog service
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, unlinkSync } from "node:fs";
import os from "node:os";

const isWin = process.platform === "win32";
const rootDir = dirname(fileURLToPath(import.meta.url));

if (isWin) {
  // Write batch file to ASCII temp path, then run it
  const batchPath = join(os.tmpdir(), "smt-dev-all.bat");
  const batch = [
    "@echo off",
    `pushd "${rootDir.replace(/"/g, '""')}"`,
    "node services\\watchdog\\watchdog.js",
    "popd"
  ].join("\r\n");
  writeFileSync(batchPath, batch, { encoding: "utf8" });

  const child = spawn("cmd", ["/c", batchPath], { shell: false, stdio: "inherit", windowsHide: true });
  child.on("exit", (code) => {
    try { unlinkSync(batchPath); } catch {}
    process.exit(code ?? 0);
  });
} else {
  const child = spawn("node", ["services/watchdog/watchdog.js"], {
    cwd: rootDir,
    stdio: "inherit",
  });
  child.on("exit", (code) => process.exit(code ?? 0));
}
