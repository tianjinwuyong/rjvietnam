import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const port = Number(process.env.SCANNER_PORT ?? 5174);
const previewPort = Number(process.env.SCANNER_PREVIEW_PORT ?? 4174);

export default defineConfig({
  root: __dirname,
  base: "/pda/scanner/",
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port,
  },
  preview: {
    host: "0.0.0.0",
    port: previewPort,
  },
  build: {
    minify: "esbuild",
  },
});
