import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../shared'),
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    fs: { allow: ['..'] },
    proxy: { '/api': 'http://localhost:4000' },
  },
  build: { chunkSizeWarningLimit: 2000 },
});
