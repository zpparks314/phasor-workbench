import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
// Imported from vitest/config, not vite, so the `test` block below type-checks.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  server: {
    port: 5173,
    // Polling costs CPU and is only needed inside a container, where
    // bind-mounted Windows filesystems do not deliver inotify events.
    watch: {
      usePolling: process.env.VITE_USE_POLLING === 'true',
    },
    // Proxying /api to the backend keeps the browser origin identical in
    // development, so CORS is not exercised on the happy path.
    proxy: {
      '/api': {
        // The proxy runs wherever the dev server runs. Natively that is the
        // host; under compose it is a container, where the backend resolves
        // by service name. Node context, so process.env rather than
        // import.meta.env.
        target: process.env.VITE_PROXY_TARGET ?? 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },

  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
