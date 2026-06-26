import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

import { createVitestBaseConfig } from 'igloo-shared/testing/vitest-base';

import { resolveConfig } from './vite.resolve';

// Unit-test config, split out of vite.config.ts so the app build and the test
// runner can evolve independently. Shares the resolve aliases + React transform
// with the app, and the version-pinned base (vitest 4 + jsdom 28) with the
// other FROSTR repos.
export default defineConfig({
  plugins: [react()],
  resolve: resolveConfig,
  test: createVitestBaseConfig({
    include: ['test/frontend/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
  }),
});
