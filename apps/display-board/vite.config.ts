import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const port = Number(process.env.DISPLAY_PORT ?? 5175);
const previewPort = Number(process.env.DISPLAY_PREVIEW_PORT ?? 4175);

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port,
    // Proxy API calls to the backend MES server
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8080",
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: "0.0.0.0",
    port: previewPort,
  },
  build: {
    // Use relative asset paths so it works when served from any sub-path
    base: "./",
    rollupOptions: {
      input: {
        main: "./index.html",
        topology: "./index-topology.html",
      },
    },
    assetsDir: "assets",
    cssCodeSplit: false,
  },
  plugins: [
    // After build, rewrite absolute /assets/ hrefs in HTML to relative paths
    {
      name: "rewrite-html-assets-to-relative",
      closeBundle() {
        const fs = require("fs");
        const path = require("path");
        const distDir = path.dirname(require.resolve("@vitejs/plugin-react"));

        // Fix index-topology.html
        const topoPath = path.join(__dirname, "dist", "index-topology.html");
        if (fs.existsSync(topoPath)) {
          let html = fs.readFileSync(topoPath, "utf8");
          html = html.replace(/src="\/assets\//g, 'src="./assets/');
          html = html.replace(/href="\/assets\//g, 'href="./assets/');
          fs.writeFileSync(topoPath, html);
        }

        // Fix index.html
        const mainPath = path.join(__dirname, "dist", "index.html");
        if (fs.existsSync(mainPath)) {
          let html = fs.readFileSync(mainPath, "utf8");
          html = html.replace(/src="\/assets\//g, 'src="./assets/');
          html = html.replace(/href="\/assets\//g, 'href="./assets/');
          fs.writeFileSync(mainPath, html);
        }
      },
    },
  ],
});
