import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '../../../../tests/e2e/helpers'

test.describe('Calendar — Views', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'calendar')
    })

    test('switch to Day view', async ({ page }) => {
        await page.getByRole('button', { name: 'Day', exact: true }).click()
        await expect(page.getByRole('button', { name: 'Day', exact: true })).toBeVisible()
    })

    test('switch to Week view', async ({ page }) => {
        await page.getByRole('button', { name: 'Week' }).click()
        await expect(page.getByRole('button', { name: 'Week' })).toBeVisible()
    })

    test('switch to Month view', async ({ page }) => {
        await page.getByRole('button', { name: 'Month' }).click()
        await expect(page.getByRole('button', { name: 'Month' })).toBeVisible()
    })
})
