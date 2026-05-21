import { expect, test } from '@playwright/test'
import { login } from './helpers'

test.describe('Help', () => {
    test('nav rail Help button opens the hub, search finds a core topic, permalink renders', async ({
        page,
    }) => {
        await login(page)

        await page.getByTestId('nav-help').click()
        await expect(page).toHaveURL(/\/a\/[^/]+\/help$/)
        await expect(page.getByText('Help', { exact: true })).toBeVisible()

        // Core topics are always present; assert one renders in the index.
        await expect(page.getByText('Light and dark themes')).toBeVisible()

        // Search narrows the list.
        await page.getByPlaceholder('Search help topics').fill('themes')
        await expect(page.getByText('Light and dark themes')).toBeVisible()

        // Clicking a topic navigates to the permalink and renders the body.
        await page.getByText('Light and dark themes').click()
        await expect(page).toHaveURL(/\/a\/[^/]+\/help\/core\/themes$/)
        await expect(page.getByText('Light and dark mode')).toBeVisible()
    })
})
