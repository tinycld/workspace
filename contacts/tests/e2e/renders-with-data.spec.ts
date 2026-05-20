import { expect, test } from '@playwright/test'

// The expo:test stack (Playwright's webServer) resets + seeds the test DB, so
// these seeded values exist. The contacts package seed inserts Alice/Bob/… into
// the PRIMARY org (test-org); login redirects to the org root which redirects to
// the first available package (contacts).
const SEEDED_EMAIL = 'user@tinycld.org'
const SEEDED_PASSWORD = 'TestUser1234!'
const A_SEEDED_CONTACT = 'Alice'

test('logs in and renders seeded contacts in the workspace', async ({ page }) => {
    await page.goto('/')

    // LoginModal exposes testIDs on its inputs + button (RN testID → web
    // data-testid). Use them — more robust than placeholder/text, and the
    // "Sign in" text appears twice (heading + button) so text would be ambiguous.
    await page.getByTestId('identifier').fill(SEEDED_EMAIL)
    await page.getByTestId('login-password').fill(SEEDED_PASSWORD)
    await page.getByTestId('login-submit').click()

    // After login: org root → first-package redirect → /a/test-org/contacts.
    // Assert via toBeAttached (DOM presence), not toBeVisible: react-native-web
    // renders these as nested divs that Playwright's visibility heuristic reports
    // as hidden even when on-screen (confirmed visually). DOM presence of the
    // "Contacts (N)" header + a seeded contact row proves login → workspace →
    // contacts-with-data worked.
    await expect(page.getByText(/Contacts \(\d+\)/).first()).toBeAttached({ timeout: 30_000 })
    await expect(page.getByText(A_SEEDED_CONTACT, { exact: false }).first()).toBeAttached({
        timeout: 30_000,
    })
})
