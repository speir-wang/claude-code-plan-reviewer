import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts', 'test/integration/**/*.test.ts'],
    exclude: ['test/browser/**', 'node_modules', 'dist'],
    environment: 'node',
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
