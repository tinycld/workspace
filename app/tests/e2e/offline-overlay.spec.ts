import { expect, test } from '@playwright/test'
import { login } from './helpers'

test.describe('Offline overlay', () => {
    test('appears when the browser goes offline and dismisses on recovery', async ({
        page,
        context,
    }) => {
        await login(page)

        await expect(page.getByTestId('offline-overlay')).toBeHidden()

        await context.setOffline(true)
        await expect(page.getByTestId('offline-overlay')).toBeVisible({ timeout: 3_000 })
        await expect(page.getByText("You're offline")).toBeVisible()

        await context.setOffline(false)
        await expect(page.getByTestId('offline-overlay')).toBeHidden({ timeout: 2_000 })
    })
})
