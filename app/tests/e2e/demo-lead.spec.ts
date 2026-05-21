import { expect, type Page, test } from '@playwright/test'

// The webServer started by playwright.config.ts is a dev.ts proxy on this
// port; it forwards /api/* to PocketBase and everything else to Expo. The
// test fires against the absolute URL because page.request runs outside
// the page's origin, but the proxy itself bridges to PB transparently.
const PB_TEST_URL = 'http://127.0.0.1:7200'

// AsyncAuthStore (configured in packages/@tinycld/core/lib/pocketbase.ts) persists the
// PocketBase auth state via @react-native-async-storage/async-storage. On web, AsyncStorage
// v3's default export is the legacy localStorage-backed implementation, so the auth state
// lands in window.localStorage under the key below. The auth-store hydration also reads
// the primary org slug from AsyncStorage (PRIMARY_ORG_STORAGE_KEY in core/lib/stores/auth-store.ts)
// — without it, getUserFromAuthStore returns a user but lib/auth.tsx-driven flows won't know
// which org slug to land on.
const AUTH_STORAGE_KEY = 'pb_auth'
const PRIMARY_ORG_STORAGE_KEY = 'tinycld_primary_org'

// Drop the singleton demo identity into localStorage before any app code runs, then
// navigate to /a/demo. addInitScript fires before every navigation in the page's
// lifetime — by the time the app hydrates pb.authStore, the token + record are already
// staged, so the auth gate doesn't bounce us back to the login screen.
async function enterDemo(page: Page) {
    const res = await page.request.post(`${PB_TEST_URL}/api/demo/start`)
    expect(res.ok()).toBe(true)
    const auth = (await res.json()) as { token: string; record: unknown }

    await page.addInitScript(
        ([authKey, orgKey, authValue, orgSlug]) => {
            // AsyncAuthStore.save serializes as JSON.stringify({ token, record }) — the
            // /api/demo/start response shape is exactly that, so we pass it straight through.
            window.localStorage.setItem(authKey, authValue)
            window.localStorage.setItem(orgKey, orgSlug)
        },
        [AUTH_STORAGE_KEY, PRIMARY_ORG_STORAGE_KEY, JSON.stringify(auth), 'demo']
    )

    await page.goto('/a/demo')
}

test.describe('demo lead capture', () => {
    test('submits via the welcome modal on first arrival', async ({ page }) => {
        await enterDemo(page)
        await page.waitForURL(/\/a\/demo(\/|$)/)

        await expect(page.getByText("You're in the demo workspace")).toBeVisible()

        await page.getByTestId('email').fill('e2e-intro@example.com')
        await page.getByTestId('reason').fill('e2e intro modal path')
        await page.getByRole('button', { name: 'Submit and explore' }).click()

        await expect(page.getByText("You're in the demo workspace")).not.toBeVisible()
        await expect(page.getByTestId('demo-banner-cta')).toBeVisible()
    })

    test('skipped on first arrival, submitted later via banner link', async ({ page }) => {
        await enterDemo(page)
        await page.waitForURL(/\/a\/demo(\/|$)/)

        await page.getByRole('button', { name: 'Skip for now' }).click()
        await expect(page.getByText("You're in the demo workspace")).not.toBeVisible()

        await expect(page.getByTestId('demo-banner-cta')).toBeVisible()
        await page.getByTestId('demo-banner-cta').click()

        await expect(page.getByText('Tell us about yourself')).toBeVisible()
        await page.getByTestId('email').fill('e2e-banner@example.com')
        await page.getByTestId('reason').fill('e2e banner path')
        await page.getByTestId('demo-followup-submit').click()

        await expect(page.getByText('Tell us about yourself')).not.toBeVisible()
        await expect(page.getByTestId('demo-banner-cta')).toBeVisible()
    })

    test('invalid email keeps the welcome modal open with an error', async ({ page }) => {
        await enterDemo(page)
        await page.waitForURL(/\/a\/demo(\/|$)/)

        await expect(page.getByText("You're in the demo workspace")).toBeVisible()

        await page.getByTestId('email').fill('not-an-email')
        await page.getByRole('button', { name: 'Submit and explore' }).click()

        await expect(page.getByText("You're in the demo workspace")).toBeVisible()
        // FormErrorSummary surfaces the same message at the top of the form
        // in addition to the per-field error, so the unscoped match is
        // ambiguous; .first() picks whichever renders first.
        await expect(page.getByText('Enter a valid email').first()).toBeVisible()
    })
})
