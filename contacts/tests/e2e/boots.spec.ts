import { expect, test } from '@playwright/test'

// Minimal e2e proving a contacts-scoped Playwright run can drive the app shell
// served by the config's webServer, with @playwright/test resolved against the
// app shell's install (via the node_modules symlink routing).
test('app shell boots and serves the contacts root route', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle(/TinyCld/)
})
