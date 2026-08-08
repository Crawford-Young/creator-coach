import { configDefaults, defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: 'happy-dom',
    globalSetup: ['./tests/globalSetup.ts'],
    setupFiles: ['./tests/setup.ts'],
    globals: true,
    // Playwright specs live under tests/e2e and must never be collected by vitest.
    exclude: [...configDefaults.exclude, 'tests/e2e/**'],
    // Multi-step form walks drive ~24 fields through userEvent; the default
    // 5s budget is tight under happy-dom on CI, so allow extra headroom.
    testTimeout: 15000,
    env: {
      NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      thresholds: {
        statements: 100,
        functions: 100,
        lines: 100,
        branches: 97,
      },
      exclude: [
        'node_modules/',
        'tests/',
        '.next/',
        'coverage/',
        'storybook-static/',
        '.storybook/**',
        'stories/**',
        '**/*.stories.{ts,tsx}',
        '**/*.config.{ts,mjs,js}',
        'src/env.ts',
        'src/instrumentation.ts',
        // Infrastructure files requiring real credentials — tested via integration/E2E
        'src/db/**',
        'src/lib/auth.ts',
        'src/lib/logger.ts',
        'src/lib/redis.ts',
        'src/lib/ui.ts',
        // Next.js App Router files — tested via E2E / component tests
        'src/app/**',
        // Auth API route
        'src/app/api/**',
        // Sentry config files
        'sentry.*.config.ts',
        // Standalone ops script — requires a live MongoDB connection, no unit test
        'scripts/**',
      ],
    },
  },
})
