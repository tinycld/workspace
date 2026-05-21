import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '../../../../tests/e2e/helpers'
import { deliverInbound, emailRow, expectRowVisible, uniqueSubject } from './helpers'

test.describe('Mail — Inbox', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'mail')
    })

    test('inbox shows unread badge in sidebar', async ({ page }) => {
        // Sidebar "Inbox" item shows the unread count next to its label.
        // Anchor on the Inbox sidebar entry rather than picking the bare
        // "2" text — search results, attachment counts, and other inboxes
        // all surface their own number badges that would otherwise match.
        const inboxItem = page.getByText('Inbox', { exact: true }).locator('xpath=..')
        await expect(inboxItem.getByText(/^\d+$/).first()).toBeVisible()
    })

    test('search filters threads', async ({ page, request }) => {
        const matchSubject = uniqueSubject('SearchHit')
        const otherSubject = uniqueSubject('SearchMiss')
        await deliverInbound(request, { subject: matchSubject })
        await deliverInbound(request, { subject: otherSubject })

        await page.reload()

        const searchInput = page.getByPlaceholder(/search/i)
        await expect(searchInput).toBeVisible()
        await searchInput.fill(matchSubject)

        await expectRowVisible(page, matchSubject)
        await expect(emailRow(page, otherSubject)).toHaveCount(0, { timeout: 5_000 })
    })
})
