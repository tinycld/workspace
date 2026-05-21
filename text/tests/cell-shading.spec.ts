import { expect, type Page, test } from '@playwright/test'
import { login, ORG_SLUG } from '../../../../tests/e2e/helpers'
import {
    EDITOR_READY_TIMEOUT,
    editorRoot,
    FEATURE_DOC_HEADING,
    TEXT_TEST_TIMEOUT,
    uniqueDocName,
    uploadDocxAsDriveItem,
    waitForEditor,
} from './_menubar-helpers'

const TEST_TIMEOUT = TEXT_TEST_TIMEOUT

async function openTablePopover(page: Page): Promise<void> {
    await page.getByRole('button', { name: 'Table', exact: true }).click()
}

test.describe('Text — Cell shading', () => {
    test.setTimeout(TEST_TIMEOUT)

    test('shading button is disabled outside a table and enabled inside', async ({ page }) => {
        const itemId = await uploadDocxAsDriveItem(uniqueDocName('shading-disabled'))
        await login(page)
        await page.goto(`/a/${ORG_SLUG}/text/${itemId}`)
        await waitForEditor(page)
        await expect(page.getByText(FEATURE_DOC_HEADING).first()).toBeVisible({
            timeout: EDITOR_READY_TIMEOUT,
        })

        await editorRoot(page).click()
        await page.keyboard.press('Home')
        const shadingBtn = page.getByRole('button', { name: 'Cell shading' })
        await expect(shadingBtn).toBeDisabled()

        await page.keyboard.press('End')
        await page.keyboard.press('Enter')
        await openTablePopover(page)
        await page.getByRole('button', { name: '2 by 2 table' }).click()

        await expect(shadingBtn).toBeEnabled()
    })

    test('picking a color writes data-shading + inline background-color to the cell', async ({
        page,
    }) => {
        const itemId = await uploadDocxAsDriveItem(uniqueDocName('shading-apply'))
        await login(page)
        await page.goto(`/a/${ORG_SLUG}/text/${itemId}`)
        await waitForEditor(page)
        await expect(page.getByText(FEATURE_DOC_HEADING).first()).toBeVisible({
            timeout: EDITOR_READY_TIMEOUT,
        })
        await expect(page.getByText('Complex Tables').first()).toBeVisible({ timeout: 30_000 })

        const tablesBefore = await editorRoot(page).locator('table').count()
        await editorRoot(page).click()
        await page.keyboard.press('End')
        await page.keyboard.press('Enter')
        await openTablePopover(page)
        await page.getByRole('button', { name: '2 by 2 table' }).click()
        await expect(editorRoot(page).locator('table')).toHaveCount(tablesBefore + 1)

        // Open shading menu and pick yellow.
        await page.getByRole('button', { name: 'Cell shading' }).click()
        await page.getByRole('button', { name: 'Apply Yellow shading' }).click()

        const shadedCell = editorRoot(page).locator('[data-shading="#FFFF00"]').first()
        await expect(shadedCell).toBeAttached({ timeout: 10_000 })
        // Inline style should carry the actual color so the visible
        // background is yellow (not just an annotation in the DOM).
        const backgroundColor = await shadedCell.evaluate(
            el => (el as HTMLElement).style.backgroundColor
        )
        expect(backgroundColor.replace(/\s+/g, '')).toMatch(/^(rgb\(255,255,0\)|#FFFF00)$/i)
    })

    test('picking "None" clears an existing shading', async ({ page }) => {
        const itemId = await uploadDocxAsDriveItem(uniqueDocName('shading-clear'))
        await login(page)
        await page.goto(`/a/${ORG_SLUG}/text/${itemId}`)
        await waitForEditor(page)
        await expect(page.getByText(FEATURE_DOC_HEADING).first()).toBeVisible({
            timeout: EDITOR_READY_TIMEOUT,
        })
        await expect(page.getByText('Complex Tables').first()).toBeVisible({ timeout: 30_000 })

        const tablesBefore = await editorRoot(page).locator('table').count()
        await editorRoot(page).click()
        await page.keyboard.press('End')
        await page.keyboard.press('Enter')
        await openTablePopover(page)
        await page.getByRole('button', { name: '2 by 2 table' }).click()
        await expect(editorRoot(page).locator('table')).toHaveCount(tablesBefore + 1)

        await page.getByRole('button', { name: 'Cell shading' }).click()
        await page.getByRole('button', { name: 'Apply Yellow shading' }).click()
        await expect(editorRoot(page).locator('[data-shading="#FFFF00"]').first()).toBeAttached()

        await page.getByRole('button', { name: 'Cell shading' }).click()
        await page.getByRole('button', { name: 'Apply None shading' }).click()
        await expect(editorRoot(page).locator('[data-shading="#FFFF00"]')).toHaveCount(0)
    })
})
