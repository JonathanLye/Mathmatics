import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@ui-math': path.resolve(__dirname, '../../packages/ui-math/src'),
      '@proof-gym/ui-math/mathText': path.resolve(__dirname, '../../packages/ui-math/src/mathText.ts'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
