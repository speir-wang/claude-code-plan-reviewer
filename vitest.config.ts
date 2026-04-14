import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts', 'test/integration/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    environment: 'node',
    testTimeout: 15000,
    hookTimeout: 15000,
    coverage: {
      provider: 'v8',
      include: [
        'src/xml.ts',
        'src/diff.ts',
        'src/conversation-preview.ts',
        'src/browser/plan-display.ts',
        'src/browser/conversation.ts',
        'src/browser/diff-view.ts',
        'src/browser/sidebar.ts',
        'src/browser/annotation.ts',
        'src/browser/feedback.ts',
      ],
      // app.ts excluded: side-effect `void main()` on import prevents unit testing.
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: 'coverage',
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
});
