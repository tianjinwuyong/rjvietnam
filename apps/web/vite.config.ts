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
      // SPA heartbeat hits /health same-origin; forward it to the API.
      '/health': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
      },
      // App-level API prefixes (no /api segment) — the SAME list nginx
      // proxies (nginx.conf `location ~ ^/(wms|hr|…)`). Without this the dev
      // server answered these calls with index.html and every WMS/HR/QMS
      // screen showed "0 条" + API DOWN while the data was in the DB.
      // Keep in sync with nginx.conf; the SPA's client routes are query-based
      // (/?view=…), so none of these prefixes is a page route.
      '^/(wms|hr|mes|pmc|qms|boms|erp|ai|admin|dashboard|equipment|equipment-supplier-comms|equipment-suppliers|factory-sim|finance|maintenance|managers|parts-pricing|parts-supplier-comms|parts-suppliers|pda|procurement|public|quality|reports|rjvn-inventory|rjvn-receipt|rjvn-wms|rjvn-iqc|rjvn-picking|rjvn-doc|spare-parts|supplier-quotes|traceability|bom-import-change-requests)(/|$)': {
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
      '/health': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
      },
      '^/(wms|hr|mes|pmc|qms|boms|erp|ai|admin|dashboard|equipment|equipment-supplier-comms|equipment-suppliers|factory-sim|finance|maintenance|managers|parts-pricing|parts-supplier-comms|parts-suppliers|pda|procurement|public|quality|reports|rjvn-inventory|rjvn-receipt|rjvn-wms|rjvn-iqc|rjvn-picking|rjvn-doc|spare-parts|supplier-quotes|traceability|bom-import-change-requests)(/|$)': {
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
