import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5178,
    host: "0.0.0.0",
    hmr: { overlay: false },
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8080",
        changeOrigin: true,
      },
    },
    watch: {
      ignored: ["**/public/fonts/**", "**/*.ttf", "**/*.woff", "**/*.woff2"],
    },
  },
});
