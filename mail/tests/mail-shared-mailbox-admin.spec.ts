import { expect, test } from '@playwright/test'
import PocketBase from 'pocketbase'
import { ORG_SLUG } from '../../../../tests/e2e/helpers'

// PB sits behind the dev.ts proxy on the test Expo port. /api/* routes
// through to PB transparently — see scripts/dev.ts::isPbPath.
const PB_URL = 'http://127.0.0.1:7200'
const SUPERUSER_EMAIL = process.env.POCKETBASE_EMAIL || 'admin@tinycld.org'
const SUPERUSER_PASSWORD = process.env.POCKETBASE_PASSWORD || 'AdminPass1234!'

interface SeededUser {
    email: string
    username: string
    password: string
    name: string
}

async function seedOrgUser(role: 'admin' | 'member', label: string): Promise<SeededUser> {
    const pb = new PocketBase(PB_URL)
    await pb.collection('_superusers').authWithPassword(SUPERUSER_EMAIL, SUPERUSER_PASSWORD)

    const stamp = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`
    const seeded: SeededUser = {
        email: `${label}-${stamp}@example.com`,
        username: `${label}${stamp.replace(/-/g, '')}`,
        password: 'TestPass1234!',
        name: `${label.charAt(0).toUpperCase() + label.slice(1)} Tester`,
    }

    const user = await pb.collection('users').create({
        email: seeded.email,
        username: seeded.username,
        password: seeded.password,
        passwordConfirm: seeded.password,
        name: seeded.name,
        emailVisibility: true,
        verified: true,
    })

    const org = await pb.collection('orgs').getFirstListItem(`slug = "${ORG_SLUG}"`)
    await pb.collection('user_org').create({
        user: user.id,
        org: org.id,
        role,
    })

    return seeded
}

async function loginAs(page: import('@playwright/test').Page, user: SeededUser) {
    await page.goto('/')
    await page.getByTestId('identifier').fill(user.email)
    await page.getByPlaceholder('Password').fill(user.password)
    await page.getByText('Sign in', { exact: true }).last().click()
    await page.waitForURL(/\/a\//, { timeout: 15_000 })
}

test.describe('Mail — Shared mailbox lifecycle as admin', () => {
    test('creating a shared mailbox with a duplicate address surfaces a form error', async ({
        page,
    }) => {
        const admin = await seedOrgUser('admin', 'dupadmin')

        await loginAs(page, admin)
        await page.goto(`/a/${ORG_SLUG}/settings/mail/mailboxes`)
        await page.waitForLoadState('domcontentloaded')
        await expect(page.getByText('Mailboxes', { exact: true }).first()).toBeVisible()

        // Create a baseline mailbox owned by this test, then attempt to
        // create a second one with the same address. The unique index
        // `idx_mail_mailboxes_addr_domain` rejects the duplicate and
        // PocketBase returns validation_not_unique. We don't reuse the
        // seeded "support" mailbox — other parallel specs may
        // delete/rename it.
        const address = `dup-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

        await page.getByText('New mailbox', { exact: true }).click()
        await expect(page.getByText('New shared mailbox')).toBeVisible()
        await page.getByTestId('address').fill(address)
        await page.getByTestId('display_name').fill('Original')
        await page.getByText('Create mailbox', { exact: true }).click()
        await expect(page.getByText('New shared mailbox')).toBeHidden({ timeout: 10_000 })

        // Now the duplicate attempt.
        await page.getByText('New mailbox', { exact: true }).click()
        await expect(page.getByText('New shared mailbox')).toBeVisible()
        await page.getByTestId('address').fill(address)
        await page.getByTestId('display_name').fill('Duplicate Test')
        await page.getByText('Create mailbox', { exact: true }).click()

        // The drawer must stay open and surface the error to the user.
        await expect(page.getByText('New shared mailbox')).toBeVisible({ timeout: 5_000 })
        await expect(page.getByText(/already|unique|in use|exists/i).first()).toBeVisible({
            timeout: 5_000,
        })
    })

    test('admin can create a shared mailbox and add another org member to it', async ({ page }) => {
        const admin = await seedOrgUser('admin', 'admin')
        const teammate = await seedOrgUser('member', 'mate')

        await loginAs(page, admin)

        await page.goto(`/a/${ORG_SLUG}/settings/mail/mailboxes`)
        await page.waitForLoadState('domcontentloaded')
        await expect(page.getByText('Mailboxes', { exact: true }).first()).toBeVisible()

        const address = `admin-${Date.now().toString(36)}`

        await page.getByText('New mailbox', { exact: true }).click()
        await expect(page.getByText('New shared mailbox')).toBeVisible()
        await page.getByTestId('address').fill(address)
        await page.getByTestId('display_name').fill('Admin Test')
        await page.getByText('Create mailbox', { exact: true }).click()

        // Drawer closes only when both inserts (mailbox + first owner member) succeed.
        await expect(page.getByText('New shared mailbox')).toBeHidden({ timeout: 10_000 })
        await expect(page.getByText(`Admin Test · 1 member`)).toBeVisible()

        // Open the mailbox in view mode to access the Members tab.
        await page.getByText(`Admin Test · 1 member`).click()
        await expect(page.getByText('Who has access')).toBeVisible({ timeout: 5_000 })

        // Add the teammate as a member of the mailbox.
        await page.getByText('Add member', { exact: true }).click()
        await page.getByText(teammate.name, { exact: true }).click()
        await page.getByText('Add', { exact: true }).last().click()

        // The drawer's Members tab shows the count; the row for the new teammate
        // appears in the "Who has access" list. Both update only when the
        // mail_mailbox_members create rule lets the owner add another user_org.
        await expect(page.getByText('Members · 2')).toBeVisible({ timeout: 10_000 })
        await expect(page.getByText(teammate.name).first()).toBeVisible()
        await expect(page.getByText(teammate.email).first()).toBeVisible()
    })
})
