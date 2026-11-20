import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'path';

// combinedwithwms —— 与 wms 独立服务对接的综合前端
// 开发时 /api 通过 Vite 代理转发到 WMS NestJS 服务（默认 http://localhost:3000）
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: process.env.VITE_WMS_API_URL || 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
