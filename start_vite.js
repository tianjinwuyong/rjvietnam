import { spawn } from "node:child_process";

const vite = spawn(
  "C:\\Users\\tianj\\Desktop\\越南工厂瑞晶\\越南工厂瑞晶\\smt-factory-system\\node_modules\\.bin\\vite.cmd",
  ["--port", "5178", "--host", "0.0.0.0"],
  {
    cwd: "C:\\Users\\tianj\\Desktop\\越南工厂瑞晶\\越南工厂瑞晶\\smt-factory-system",
    stdio: "inherit",
    shell: false,
  }
);

vite.on("exit", (code) => process.exit(code ?? 0));
