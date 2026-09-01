import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  cacheDir: '../../node_modules/.vite-ruijing-web-20260729',
  plugins: [react()],
  resolve: {
    dedupe: [
      'react',
      'react-dom',
      'react-dom/client',
      'react-dom/server',
      'react-is',
      'scheduler',
      'scheduler/tracing',
      'react-reconciler',
      'react-test-renderer',
      'three',
    ],
    alias: [
      { find: 'stats.js', replacement: 'stats.js/build/stats.min.js' },
    ],
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'zustand',
    ],
    exclude: ['three'],
  },
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        manualLineVideo3d: fileURLToPath(new URL('./manual-line-video-3d.html', import.meta.url)),
        autoLineVideo3d: fileURLToPath(new URL('./auto-line-video-3d.html', import.meta.url)),
        supplierLabel: fileURLToPath(new URL('./supplier-label.html', import.meta.url)),
      },
    },
  },
  server: {
    port: 5178,
    host: '0.0.0.0',
    hmr: { overlay: false },
    headers: {
      'Cache-Control': 'no-store',
    },
    proxy: {
      '/supplier-api': {
        target: 'http://127.0.0.1:8098',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/supplier-api/, ''),
      },
      '/api/pda': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
        proxyTimeout: 30000,
        timeout: 30000,
      },
      '/api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
        proxyTimeout: 30000,
        timeout: 30000,
      },
    },
  },
  preview: {
    port: 5178,
    host: '0.0.0.0',
    proxy: {
      '/supplier-api': {
        target: 'http://127.0.0.1:8098',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/supplier-api/, ''),
      },
      '/api/pda': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
      },
      '/api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
      },
    },
  },
});
