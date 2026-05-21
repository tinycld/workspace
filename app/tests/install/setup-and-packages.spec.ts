import { expect, type Page, test } from '@playwright/test'

// Smoke-tests for the /setup flow. Split into three tests so most of the
// coverage runs without the one-time PW_SETUP_TOKEN:
//   1. bootstrap (needs PW_SETUP_TOKEN) — fills the first-run wizard and
//      creates the superuser. Skipped if the token isn't exported.
//   2. dashboard packages tab — logs in as the superuser, asserts every
//      bundled feature package shows up.
//   3. organization creation — logs in as the superuser, creates a test org,
//      asserts it appears in the list. Regression test for the missing
//      'username' bug on user create.
//
// The tests run serially: tests 2 and 3 depend on the superuser created by
// test 1 (or by a previous bootstrap if PW_SETUP_TOKEN was consumed earlier).
//
// PW_SETUP_TOKEN is scraped from `docker logs <container>` by the workflow
// before invoking playwright.

const SETUP_TOKEN = process.env.PW_SETUP_TOKEN

// Adjust this list when the public-CI default LINKED_PACKAGES set changes.
// The names match `bundled-packages.json::name` (capitalized labels), which
// is what PackageManager renders on the dashboard.
const EXPECTED_BUNDLED = ['Mail', 'Calendar', 'Contacts', 'Drive', 'Google Takeout Import']

const SUPERUSER_EMAIL = 'smoke@example.com'
const SUPERUSER_PASSWORD = 'SmokeTest1234!'

const TEST_ORG_NAME = 'Smoke Org'
const TEST_ORG_SLUG = 'smoke-org'
const TEST_ORG_OWNER_NAME = 'Smoke Owner'
const TEST_ORG_OWNER_EMAIL = 'owner@smoke.example'
const TEST_ORG_OWNER_PASSWORD = 'OwnerPass1234!'
const TEST_ORG_MAIL_DOMAIN = 'smoke.example'

async function loginAsSuperuser(page: Page) {
    await page.goto('/setup')
    await expect(page.getByText('Superuser Login')).toBeVisible()
    await page.getByRole('textbox', { name: 'Email', exact: true }).fill(SUPERUSER_EMAIL)
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill(SUPERUSER_PASSWORD)
    await page.getByRole('button', { name: 'Sign in' }).click()
    // The dashboard renders the tab strip; wait for it before assertions.
    await expect(page.getByText('Organizations', { exact: true })).toBeVisible()
}

test.describe.configure({ mode: 'serial' })

test.describe('first-run install', () => {
    test('bootstrap superuser via /setup wizard', async ({ page }) => {
        test.skip(
            !SETUP_TOKEN,
            'PW_SETUP_TOKEN not set — workflow must scrape it from `docker logs` and export before running'
        )

        await page.goto(`/setup?token=${SETUP_TOKEN}`)

        await expect(page.getByText('Welcome to TinyCld')).toBeVisible()

        await page.getByRole('textbox', { name: 'Email', exact: true }).fill(SUPERUSER_EMAIL)
        await page.getByRole('textbox', { name: 'Password', exact: true }).fill(SUPERUSER_PASSWORD)
        await page
            .getByRole('textbox', { name: 'Confirm Password', exact: true })
            .fill(SUPERUSER_PASSWORD)

        await page.getByRole('button', { name: 'Create Account & Continue' }).click()

        // Setup wizard transitions in-place to the dashboard with the
        // Organizations tab active.
        await expect(page.getByText('No organizations yet.')).toBeVisible()
    })

    test('superuser dashboard lists every bundled package', async ({ page }) => {
        await loginAsSuperuser(page)

        // Login lands on the Packages tab by default.
        for (const pkg of EXPECTED_BUNDLED) {
            await expect(
                page.getByText(pkg, { exact: true }),
                `bundled package ${pkg} should appear in the dashboard`
            ).toBeVisible()
        }

        // And confirm the count of "bundled" tags matches — guards against a
        // regression that drops a package without changing its name.
        const bundledTags = page.getByText('bundled', { exact: true })
        await expect(bundledTags).toHaveCount(EXPECTED_BUNDLED.length)
    })

    test('superuser can create an organization', async ({ page }) => {
        await loginAsSuperuser(page)

        await page.getByText('Organizations', { exact: true }).first().click()

        // Regression test for "Failed to create record. The username field
        // is required." — the form previously omitted username on the user
        // create, which is now derived from the email.
        await page.getByRole('button', { name: 'New Organization' }).click()

        await page
            .getByRole('textbox', { name: 'Organization Name', exact: true })
            .fill(TEST_ORG_NAME)
        // The slug auto-derives from the name; overwrite to make the assertion
        // explicit and decoupled from the derivation rules.
        await page.getByRole('textbox', { name: 'Slug', exact: true }).fill(TEST_ORG_SLUG)
        await page
            .getByRole('textbox', { name: 'Owner Name', exact: true })
            .fill(TEST_ORG_OWNER_NAME)
        await page
            .getByRole('textbox', { name: 'Owner Email', exact: true })
            .fill(TEST_ORG_OWNER_EMAIL)
        await page
            .getByRole('textbox', { name: 'Owner Password', exact: true })
            .fill(TEST_ORG_OWNER_PASSWORD)
        // Mail is in EXPECTED_BUNDLED so the form requires a mail domain.
        await page
            .getByRole('textbox', { name: 'Mail Domain', exact: true })
            .fill(TEST_ORG_MAIL_DOMAIN)

        await page.getByRole('button', { name: 'Create Organization' }).click()

        // After creation the form closes and the org row renders with name + slug.
        await expect(page.getByText('No organizations yet.')).not.toBeVisible()
        await expect(page.getByText(TEST_ORG_NAME, { exact: true })).toBeVisible()
        await expect(page.getByText(TEST_ORG_SLUG, { exact: true })).toBeVisible()
        await expect(page.getByText(TEST_ORG_OWNER_EMAIL, { exact: true })).toBeVisible()
    })
})
