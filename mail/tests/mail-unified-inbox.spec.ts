import { expect, test } from '@playwright/test'
import { clickSidebarItem, login, navigateToPackage } from '../../../../tests/e2e/helpers'
import { deliverInbound, emailRow, expectRowVisible, openThread, uniqueSubject } from './helpers'

test.describe('Mail — Unified inbox', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'mail')
    })

    test('All Inboxes lists threads from both personal and shared mailboxes', async ({
        page,
        request,
    }) => {
        const personalSubject = uniqueSubject('UnifiedPersonal')
        const sharedSubject = uniqueSubject('UnifiedShared')
        await deliverInbound(request, { subject: personalSubject, to: 'user@tinycld.org' })
        await deliverInbound(request, { subject: sharedSubject, to: 'support@tinycld.org' })
        await page.reload()

        await clickSidebarItem(page, 'All Inboxes')
        await expect(page).toHaveURL(/folder=all-inboxes/)

        await expectRowVisible(page, personalSubject)
        await expectRowVisible(page, sharedSubject)

        // Each unified-list row tags the source mailbox via display_name
        // ("Support" for the shared mailbox) or "Personal" for the user's
        // primary mailbox.
        await expect(
            emailRow(page, sharedSubject).getByText('Support', { exact: true })
        ).toBeVisible()
        await expect(
            emailRow(page, personalSubject).getByText('Personal', { exact: true })
        ).toBeVisible()
    })

    test('opening a thread from All Inboxes preserves the unified context on back', async ({
        page,
        request,
    }) => {
        const subject = uniqueSubject('UnifiedBack')
        await deliverInbound(request, { subject, to: 'support@tinycld.org' })
        await page.reload()

        await clickSidebarItem(page, 'All Inboxes')
        await expect(page).toHaveURL(/folder=all-inboxes/)

        await openThread(page, subject)
        await expect(page).toHaveURL(/\/mail\//)

        await page.goBack()
        await expect(page).toHaveURL(/folder=all-inboxes/)
        await expectRowVisible(page, subject)
    })
})
