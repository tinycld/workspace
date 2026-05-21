import { expect, test } from '@playwright/test'
import { login, ORG_SLUG } from '../../../../tests/e2e/helpers'

test.describe('Mail — Shared mailbox creation', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
        await page.goto(`/a/${ORG_SLUG}/settings/mail/mailboxes`)
        await page.waitForLoadState('domcontentloaded')
        await expect(page.getByText('Mailboxes', { exact: true }).first()).toBeVisible()
    })

    test('creating a shared mailbox adds it with the creator as owner', async ({ page }) => {
        const address = `shared-${Date.now().toString(36)}`

        await page.getByText('New mailbox', { exact: true }).click()
        await expect(page.getByText('New shared mailbox')).toBeVisible()

        await page.getByTestId('address').fill(address)
        await page.getByTestId('display_name').fill('Shared Test')

        await page.getByText('Create mailbox', { exact: true }).click()

        // Drawer closes only when both inserts (mailbox + first owner member) succeed.
        await expect(page.getByText('New shared mailbox')).toBeHidden({ timeout: 10_000 })
        await expect(page.getByText(address).first()).toBeVisible()
        await expect(page.getByText('Shared Test · 1 member')).toBeVisible()
    })
})
