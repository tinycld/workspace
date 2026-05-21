import { expect, test } from '@playwright/test'
import { login, ORG_SLUG } from '../../../../tests/e2e/helpers'

test.describe('Calendar — Events', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
    })

    test('create new event form can be filled', async ({ page }) => {
        const title = `Test Event ${Date.now()}`

        await page.goto(`/a/${ORG_SLUG}/calendar/new`)
        await expect(page.getByText('New Event')).toBeVisible()

        await page.getByPlaceholder('Event title').fill(title)
        await expect(page.getByPlaceholder('Event title')).toHaveValue(title)
        await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled()
    })

    test('event form blocks save with empty title', async ({ page }) => {
        await page.goto(`/a/${ORG_SLUG}/calendar/new`)
        await expect(page.getByText('New Event')).toBeVisible()

        const titleInput = page.getByPlaceholder('Event title')
        await titleInput.clear()
        await page.getByRole('button', { name: 'Save' }).click()

        // Validation should prevent save — form should still be visible.
        await expect(page.getByText('New Event')).toBeVisible()
    })
})
