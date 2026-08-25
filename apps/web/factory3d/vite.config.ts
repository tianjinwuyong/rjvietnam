import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  // Standalone entry — no alias to parent React
  resolve: {
    dedupe: ['react', 'react-dom', 'react-dom/client'],
  },
  optimizeDeps: {
    include: [
      'react', 'react-dom', 'react-dom/client',
      '@react-three/fiber', '@react-three/drei', 'three',
      'zustand',
    ],
  },
  server: {
    port: 5179,
    host: '0.0.0.0',
    hmr: { overlay: false },
    fs: {
      allow: ['..'],
    },
  },
  build: {
    outDir: '../../dist-factory3d',
    emptyOutDir: true,
  },
});
