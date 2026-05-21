import { defineConfig, devices } from '@playwright/test'

// Self-contained Playwright config for the docker-image smoke test. Talks
// to an already-running TinyCld container (started by the CI workflow or
// the local runner). No webServer, no globalSetup, no DB fixtures —
// exercises the same path a real operator follows when running the
// instructions on tinycld.org/docs/installation.
//
// BASE_URL: where the container's HTTP listener is reachable.
// SETUP_TOKEN: scraped from `docker logs <container>` and exported as
//   PW_SETUP_TOKEN before invoking playwright.
const BASE_URL = process.env.PW_BASE_URL ?? 'http://localhost:7090'

export default defineConfig({
    testDir: '.',
    testMatch: '**/*.spec.ts',
    fullyParallel: false,
    workers: 1,
    forbidOnly: !!process.env.CI,
    retries: 0,
    timeout: 60_000,
    expect: { timeout: 15_000 },
    reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
    use: {
        baseURL: BASE_URL,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
    },
    projects: [
        {
            name: 'install-smoke',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
})
