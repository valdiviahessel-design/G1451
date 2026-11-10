import { defineConfig } from 'vite';

export default defineConfig({
  // Yandex Games serves the build from a nested path, so every URL must be relative.
  base: './',
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1500,
  },
  server: { host: true },
});
