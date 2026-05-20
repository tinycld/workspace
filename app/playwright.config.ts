import { defineConfig, devices } from '@playwright/test'

// App shell owns the canonical Playwright config: the webServer (the dev stack)
// and the browser project. Package-scoped runs inherit this and override
// `testDir` to point at one package's tests/e2e through the node_modules
// symlink, so @playwright/test resolves against the app shell's install.
const PORT = Number(process.env.SPIKE_E2E_PORT ?? 7300)

export default defineConfig({
    testMatch: '**/*.spec.ts',
    use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://localhost:${PORT}`,
    },
    webServer: {
        command: 'node tests/serve-dist.mjs',
        cwd: import.meta.dirname,
        url: `http://localhost:${PORT}`,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
    },
})
