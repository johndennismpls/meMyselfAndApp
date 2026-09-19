import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    // The engine is pure TS, so node is enough — no DOM environment needed.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  server: {
    proxy: {
      // Anything under /api is forwarded to the Nest API on :3000,
      // so the browser only ever talks to its own origin (no CORS).
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
