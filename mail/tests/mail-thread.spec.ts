import { test } from '@playwright/test'
import { clickSidebarItem, login, navigateToPackage } from '../../../../tests/e2e/helpers'
import {
    deliverInbound,
    expectRowVisible,
    navigateToPersonalInbox,
    openThread,
    threadDetail,
    uniqueSubject,
} from './helpers'

test.describe('Mail — Thread Detail', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'mail')
        // The seed creates a shared "Support" mailbox in addition to the
        // personal one, so the default landing page is "All Inboxes". These
        // tests reason about a thread's *folder* (inbox vs. archive vs.
        // trash), so they need a scoped view first.
        await navigateToPersonalInbox(page)
    })

    test('archive thread from detail', async ({ page, request }) => {
        const subject = uniqueSubject('Archive')
        await deliverInbound(request, { subject })
        await page.reload()
        await navigateToPersonalInbox(page)

        await openThread(page, subject)
        await threadDetail(page).getByLabel('Archive').click()
        await page.waitForURL(url => !url.pathname.includes('/mail/'), { timeout: 10_000 })

        await clickSidebarItem(page, 'Archive')
        await expectRowVisible(page, subject)
    })

    test('delete thread from detail', async ({ page, request }) => {
        const subject = uniqueSubject('Delete')
        await deliverInbound(request, { subject })
        await page.reload()
        await navigateToPersonalInbox(page)

        await openThread(page, subject)
        await threadDetail(page).getByLabel('Delete').click()
        await page.waitForURL(url => !url.pathname.includes('/mail/'), { timeout: 10_000 })

        await clickSidebarItem(page, 'Trash')
        await expectRowVisible(page, subject)
    })
})
