import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '../../../../tests/e2e/helpers'
import { openNewSpreadsheet } from './_menubar-helpers'

// Regression — when one menubar menu was open and the user moved the
// pointer left across siblings, the swapped-in menu's popover used to
// render at the top-left of the viewport because its <Menu> root never
// recorded a triggerLayout (only click measured the trigger; the
// hover-swap path didn't). The fix measures the trigger on mouseenter.
//
// Each menu's first item is unique, so we can both confirm the right
// menu swapped in and check that its position is anchored to the trigger
// rather than the viewport origin.
const SEQUENCE: Array<{ label: string; firstItem: RegExp }> = [
    { label: 'Data', firstItem: /^Sort range$/ },
    { label: 'Format', firstItem: /^Number$/ },
    { label: 'View', firstItem: /^Freeze$/ },
    // Edit's "Undo" carries a ⌘Z shortcut; the accessible name combines them.
    { label: 'Edit', firstItem: /^Undo\b/ },
    { label: 'File', firstItem: /^New spreadsheet$/ },
]

test.describe('Calc menubar hover swap', () => {
    test.setTimeout(180_000)
    test.beforeEach(async ({ page }) => {
        await login(page)
    })

    test('hovering each trigger leftward keeps the popover anchored under it', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        await page.getByRole('button', { name: 'Help', exact: true }).click()
        await expect(page.getByRole('menuitem', { name: 'Keyboard shortcuts' })).toBeVisible()

        for (const { label, firstItem } of SEQUENCE) {
            await page.getByRole('button', { name: label, exact: true }).hover()

            const trigger = page.getByRole('button', { name: label, exact: true })
            const item = page.getByRole('menuitem', { name: firstItem })

            await expect(item).toBeVisible()

            const triggerBox = await trigger.boundingBox()
            const itemBox = await item.boundingBox()
            expect(triggerBox, `${label} trigger box`).not.toBeNull()
            expect(itemBox, `${label} first menuitem box`).not.toBeNull()
            if (!triggerBox || !itemBox) continue

            expect(
                itemBox.y,
                `${label} popover should sit below its trigger row`
            ).toBeGreaterThan(triggerBox.y + triggerBox.height - 1)

            const triggerCenter = triggerBox.x + triggerBox.width / 2
            const itemRight = itemBox.x + itemBox.width
            expect(
                itemBox.x,
                `${label} popover should be horizontally near its trigger (was anchored at viewport origin in the bug)`
            ).toBeLessThan(triggerCenter)
            expect(itemRight, `${label} popover should extend past trigger center`).toBeGreaterThan(
                triggerCenter
            )
        }
    })
})
