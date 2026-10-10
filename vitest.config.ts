import { defineConfig } from 'vitest/config';

export default defineConfig({
  // node:* (از جمله node:sqlite) ماژول داخلی است — external
  ssr: {
    external: [/^node:/],
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    pool: 'forks',
    server: {
      deps: {
        external: [/^node:/],
      },
    },
    poolOptions: {
      forks: {
        execArgv: [],
      },
    },
  },
});
