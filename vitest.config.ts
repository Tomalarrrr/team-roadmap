import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { slugsRules } from './vite.config';

export default defineConfig({
  plugins: [react()],
  define: { __SLUGS_RULES__: String(slugsRules()) },
  test: {
    globals: true,
    environment: 'jsdom',
    // Agent worktrees under .claude hold whole copies of src, each with its own tests.
    exclude: [...configDefaults.exclude, '.claude/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/utils/**/*.ts'],
    },
  },
});
