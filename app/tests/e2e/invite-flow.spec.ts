import { expect, test } from '@playwright/test'
import { clearEmailLog, waitForEmailTo } from './email-log-helpers'
import { login, ORG_SLUG, TEST_USER_EMAIL, TEST_USER_PASSWORD } from './helpers'

// End-to-end invite flow:
//   1. Owner signs in and invites a fresh user via Settings → Members.
//   2. The Go user_org hook mints an invite_tokens row and the UI's InviteLinkPanel
//      surfaces the accept URL directly (no auto-email for new invites).
//   3. The invited user visits the /accept-invite/{token} link, sets a password,
//      and is auto-logged-in and redirected to /a/{slug}.
//   4. The invited user signs out, then signs back in with the new password.

test.describe('Invite flow', () => {
    // Unique username per run — the test DB is reset across runs but not between tests.
    const inviteUsername = `invitee${Date.now()}`
    const invitePassword = 'BrandNewPass1!'

    test('owner invites user, user sets password, logs out, logs back in', async ({ page }) => {
        clearEmailLog()

        // --- 1. Owner signs in and sends an invite ---
        await login(page)

        await page.goto(`/a/${ORG_SLUG}/settings/members`)
        // Open the invite drawer.
        await page.getByText('Invite', { exact: true }).click()
        await expect(page.getByText('Invite a teammate', { exact: true })).toBeVisible({
            timeout: 10_000,
        })

        // Fill username only — proves email is optional.
        await page.getByTestId('username').fill(inviteUsername)
        await page.getByText('Send invite', { exact: true }).click()

        // --- 2. Invite link panel surfaces the accept URL directly ---
        await expect(page.getByTestId('invite-link-step')).toBeVisible({ timeout: 10_000 })
        const urlText = await page.getByTestId('invite-link-url').textContent()
        const tokenMatch = urlText?.match(/\/accept-invite\/([0-9a-f]{64})/)
        expect(tokenMatch).not.toBeNull()
        const token = tokenMatch![1]

        // Close the link panel so subsequent navigation is clean.
        await page.getByTestId('invite-link-done').click()

        // --- 3. Invited user accepts the invite in a fresh browser context ---
        // Use a new context so the owner's auth doesn't bleed in.
        const inviteePage = await page.context().browser()!.newContext()
        const invitee = await inviteePage.newPage()

        await invitee.goto(`/accept-invite/${token}`)
        await expect(invitee.getByText(/Welcome to/i)).toBeVisible({ timeout: 10_000 })

        await invitee.getByTestId('name').fill('Test Invitee')
        await invitee.getByTestId('password').fill(invitePassword)
        await invitee.getByTestId('confirmPassword').fill(invitePassword)
        await invitee.getByText(/Set password and sign in/i).click()

        // Auto-login + router.replace should land us on /a/{slug}.
        await invitee.waitForURL(new RegExp(`/a/${ORG_SLUG}`), { timeout: 15_000 })

        // --- 4. Sign out, sign back in with the new password ---
        // The user menu lives in the sidebar; it exposes a "Sign out" menu item.
        // Rather than clicking through the menu chrome, clear auth directly —
        // that's what the UserMenu does internally, and it's more resilient to
        // menu layout changes.
        await invitee.evaluate(() => {
            window.localStorage.clear()
            window.sessionStorage.clear()
        })
        await invitee.goto('/')

        // Back to the login modal — sign in as the invitee by username with their new creds.
        await invitee.getByTestId('identifier').fill(inviteUsername)
        await invitee.getByPlaceholder('Password').fill(invitePassword)
        await invitee.getByText('Sign in', { exact: true }).last().click()
        await invitee.waitForURL(/\/a\//, { timeout: 15_000 })

        // Sanity: URL is under the owner's org (the invitee is now a member).
        expect(invitee.url()).toContain(`/a/${ORG_SLUG}`)

        // Guard: original test user can still sign in (password unchanged).
        // This catches regressions where accept-invite accidentally overwrites
        // the wrong user.
        await invitee.evaluate(() => {
            window.localStorage.clear()
            window.sessionStorage.clear()
        })
        await invitee.goto('/')
        await invitee.getByTestId('identifier').fill(TEST_USER_EMAIL)
        await invitee.getByPlaceholder('Password').fill(TEST_USER_PASSWORD)
        await invitee.getByText('Sign in', { exact: true }).last().click()
        await invitee.waitForURL(/\/a\//, { timeout: 15_000 })

        await inviteePage.close()
    })

    test('admin sends invite link to an alternate email address', async ({ page }) => {
        clearEmailLog()
        const altInviteUsername = `inviteealt${Date.now()}`
        const altEmail = `personal-${Date.now()}@example.com`

        await login(page)
        await page.goto(`/a/${ORG_SLUG}/settings/members`)
        await page.getByText('Invite', { exact: true }).click()
        await expect(page.getByText('Invite a teammate', { exact: true })).toBeVisible({
            timeout: 10_000,
        })

        // Fill username only — proves email is optional at invite creation.
        await page.getByTestId('username').fill(altInviteUsername)
        await page.getByText('Send invite', { exact: true }).click()
        await expect(page.getByTestId('invite-link-step')).toBeVisible({ timeout: 10_000 })

        await page.getByTestId('invite-link-send-toggle').click()
        await page.getByTestId('invite-link-alt-email').fill(altEmail)
        await page.getByTestId('invite-link-send').click()

        // The mailer's LogSender writes to the email log. Wait for an entry
        // addressed to the alt email — NOT the invitee's account email.
        const email = await waitForEmailTo(altEmail, {
            subjectMatch: /invited to/i,
            timeoutMs: 10_000,
        })
        expect(email.subject).toMatch(/invited to/i)
    })

    test('rotate invalidates the old invite link', async ({ page }) => {
        const rotateInviteUsername = `inviteerotate${Date.now()}`

        await login(page)
        await page.goto(`/a/${ORG_SLUG}/settings/members`)
        await page.getByText('Invite', { exact: true }).click()
        await expect(page.getByText('Invite a teammate', { exact: true })).toBeVisible({
            timeout: 10_000,
        })

        // Fill username only — proves email is optional.
        await page.getByTestId('username').fill(rotateInviteUsername)
        await page.getByText('Send invite', { exact: true }).click()
        await expect(page.getByTestId('invite-link-step')).toBeVisible({ timeout: 10_000 })

        const oldUrl = (await page.getByTestId('invite-link-url').textContent()) ?? ''
        expect(oldUrl).toMatch(/\/accept-invite\/[0-9a-f]{64}/)

        await page.getByTestId('invite-link-rotate').click()

        // Wait for the URL element to display a different URL.
        await expect
            .poll(async () => (await page.getByTestId('invite-link-url').textContent()) ?? '', {
                timeout: 5_000,
            })
            .not.toBe(oldUrl)

        // Visiting the old token must fail. The panel URL may include the
        // PocketBase server origin (not the Expo dev server), so extract just
        // the path to navigate via Playwright's configured baseURL.
        const oldPath = new URL(oldUrl, 'http://localhost').pathname
        const fresh = await page.context().browser()!.newContext()
        const freshPage = await fresh.newPage()
        await freshPage.goto(oldPath)
        await expect(freshPage.getByText(/expired|invalid|already been used/i)).toBeVisible({
            timeout: 10_000,
        })
        await fresh.close()
    })
})
