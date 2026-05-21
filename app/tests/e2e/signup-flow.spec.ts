import { expect, test } from '@playwright/test'

test.describe('Signup removed', () => {
    test('login page does not show signup link', async ({ page }) => {
        await page.goto('/')

        await expect(page.getByText('Sign in').first()).toBeVisible({ timeout: 10_000 })

        await expect(page.getByText("Don't have an account?")).not.toBeVisible()
        await expect(page.getByText('Create one')).not.toBeVisible()
    })
})
