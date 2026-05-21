import { expect, test } from '@playwright/test'
import { clickSidebarItem, login, navigateToPackage } from '../../../../tests/e2e/helpers'

// These tests assert that each folder route mounts successfully — i.e.
// clicking the sidebar entry navigates to the right URL. Asserting on
// specific seeded thread subjects is fragile because parallel specs
// archive/delete/trash threads and the folder contents drift.

test.describe('Mail — Navigation', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'mail')
    })

    test('navigate to Sent', async ({ page }) => {
        await clickSidebarItem(page, 'Sent')
        await expect(page).toHaveURL(/folder=sent/)
    })

    test('navigate to Drafts', async ({ page }) => {
        await clickSidebarItem(page, 'Drafts')
        await expect(page).toHaveURL(/folder=drafts/)
    })

    test('navigate to Starred', async ({ page }) => {
        await clickSidebarItem(page, 'Starred')
        await expect(page).toHaveURL(/folder=starred/)
    })

    test('navigate to Trash', async ({ page }) => {
        await clickSidebarItem(page, 'Trash')
        await expect(page).toHaveURL(/folder=trash/)
    })

    test('navigate to Spam', async ({ page }) => {
        await clickSidebarItem(page, 'Spam')
        await expect(page).toHaveURL(/folder=spam/)
    })
})
