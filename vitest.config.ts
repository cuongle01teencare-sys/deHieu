import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`.
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    // web/ (Next.js) có công cụ test riêng
    exclude: ['**/node_modules/**', 'dist/**', 'web/**'],
  },
});
