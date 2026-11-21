import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const port = Number(process.env.EMPLOYEE_APP_PORT ?? 5175);
const previewPort = Number(process.env.EMPLOYEE_APP_PREVIEW_PORT ?? 4175);

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  server: { host: "0.0.0.0", port },
  preview: { host: "0.0.0.0", port: previewPort },
  build: { minify: "esbuild" },
});
