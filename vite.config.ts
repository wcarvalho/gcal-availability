import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    hmr: {
      overlay: false // Temporarily disable error overlay
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    }
  }
});
