import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'

// App shell owns the canonical Playwright config: the webServer (the real dev
// stack via `npm run expo:test`, which resets the test DB then boots PB+Expo
// behind a proxy on PORT) and the browser project. Package-scoped configs
// inherit this and override `testDir` to point at one package's tests/e2e
// through the node_modules symlink, so @playwright/test resolves against the
// app shell's install.
const PORT = Number(process.env.E2E_PORT ?? 7200)

export default defineConfig({
    testMatch: '**/*.spec.ts',
    use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://localhost:${PORT}`,
    },
    webServer: {
        command: 'npm run expo:test',
        cwd: import.meta.dirname,
        // expo:test resets the DB then boots PB+Expo behind the proxy on PORT;
        // /api/health proxies to PB, so wait on that (not the Expo bundle).
        url: `http://localhost:${PORT}/api/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 240_000,
    },
    // Absolute path: per-package configs spread this config, and Playwright
    // resolves a relative globalSetup against the INHERITING config's dir —
    // so a relative './tests/...' would break for contacts/etc. Pin it here.
    globalSetup: path.join(import.meta.dirname, 'tests', 'playwright-global-setup.ts'),
})
