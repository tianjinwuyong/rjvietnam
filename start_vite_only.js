import { spawn } from "node:child_process";
import path from "node:path";

const webDir = path.join(
  "C:\\Users\\tianj\\Desktop\\越南工厂瑞晶\\越南工厂瑞晶\\smt-factory-system",
  "apps", "web"
);

const vite = spawn("node", ["node_modules/vite/bin/vite.js", "--port", "5178", "--host", "127.0.0.1"], {
  cwd: webDir,
  stdio: "inherit",
  shell: true,
});

vite.on("exit", (code) => process.exit(code ?? 0));
