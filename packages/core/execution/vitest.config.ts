import path from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
  resolve: {
    alias: {
      '@inboxfm-connect/core-utils': path.resolve(__dirname, '../utils/src/index.ts'),
    },
  },
})
