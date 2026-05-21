import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '../../../../tests/e2e/helpers'

test.describe('Mail — Compose', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'mail')
    })

    test('open compose from sidebar', async ({ page }) => {
        await page.getByText('Compose', { exact: true }).click()

        await expect(page.getByText('To', { exact: true })).toBeVisible()
        await expect(page.getByText('Subject', { exact: true })).toBeVisible()
        await expect(page.getByText('Send', { exact: true })).toBeVisible()
    })

    test('close compose without sending', async ({ page }) => {
        await page.getByText('Compose', { exact: true }).click()
        await expect(page.getByText('To', { exact: true })).toBeVisible()

        await page.keyboard.press('Escape')
    })
})
