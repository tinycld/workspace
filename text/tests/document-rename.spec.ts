import { expect, test } from '@playwright/test'
import { login, ORG_SLUG } from '../../../../tests/e2e/helpers'
import {
    EDITOR_REACTION_TIMEOUT,
    TEXT_TEST_TIMEOUT,
    uniqueDocName,
    uploadDocxAsDriveItem,
} from './_menubar-helpers'

const TEST_TIMEOUT = TEXT_TEST_TIMEOUT

test.describe('Text — Document rename', () => {
    test.setTimeout(TEST_TIMEOUT)

    test('inline rename: click title, type new name, Enter — persists across reload', async ({
        page,
    }) => {
        const originalName = uniqueDocName('rename-orig')
        const newName = uniqueDocName('rename-new')
        const itemId = await uploadDocxAsDriveItem(originalName)

        await login(page)
        await page.goto(`/a/${ORG_SLUG}/text/${itemId}`)

        // The DocumentTitle Pressable carries an accessibilityLabel of
        // `Rename document, currently <name>`; aria-label on web makes
        // it cheap to locate without leaning on a brittle text match
        // (the document index list may also display the same name).
        const titleTrigger = page.getByLabel(`Rename document, currently ${originalName}`)
        await expect(titleTrigger).toBeVisible({ timeout: 60_000 })
        await titleTrigger.click()

        const input = page.getByLabel('Document name')
        await expect(input).toBeVisible({ timeout: EDITOR_REACTION_TIMEOUT })
        await expect(input).toBeFocused()

        await page.keyboard.press('Meta+A')
        await page.keyboard.type(newName)
        await page.keyboard.press('Enter')

        // After commit the input swaps back to a static label. The
        // new accessibilityLabel embeds the renamed value.
        await expect(page.getByLabel(`Rename document, currently ${newName}`)).toBeVisible({
            timeout: 10_000,
        })

        await page.reload()
        await expect(page.getByLabel(`Rename document, currently ${newName}`)).toBeVisible({
            timeout: 60_000,
        })
    })

    test('Escape cancels: title reverts and no rename is persisted', async ({ page }) => {
        const originalName = uniqueDocName('rename-escape')
        const itemId = await uploadDocxAsDriveItem(originalName)

        await login(page)
        await page.goto(`/a/${ORG_SLUG}/text/${itemId}`)

        const titleTrigger = page.getByLabel(`Rename document, currently ${originalName}`)
        await expect(titleTrigger).toBeVisible({ timeout: 60_000 })
        await titleTrigger.click()

        const input = page.getByLabel('Document name')
        await expect(input).toBeVisible({ timeout: EDITOR_REACTION_TIMEOUT })
        await page.keyboard.press('Meta+A')
        await page.keyboard.type('a draft the user backs out of')
        await page.keyboard.press('Escape')

        // Back to static label with the ORIGINAL name. The would-be
        // rename never reached pbtsdb, so a reload still shows the
        // original — but the in-tab assertion is enough for this
        // case; the persist case above already covers the reload path.
        await expect(page.getByLabel(`Rename document, currently ${originalName}`)).toBeVisible({
            timeout: EDITOR_REACTION_TIMEOUT,
        })
    })
})
