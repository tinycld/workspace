import { expect, test } from '@playwright/test'
import { isPackageLinked, login, navigateToPackage, ORG_SLUG } from './helpers'

// These tests navigate through package-contributed routes (mail, contacts)
// and assert on package-owned UI like email rows. When core runs standalone
// (e.g. its own CI) those routes don't exist, so skip rather than fail.
const mailLinked = isPackageLinked('mail')
const contactsLinked = isPackageLinked('contacts')

test.describe('Keyboard shortcuts', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
    })

    test('? opens the help dialog and Escape closes it', async ({ page }) => {
        test.skip(!mailLinked, 'mail package not linked')
        await navigateToPackage(page, 'mail')
        // Wait for the rail to render so the shortcut provider has mounted
        // and tinykeys has bound its listeners before we start typing.
        await expect(page.getByRole('link', { name: 'Mail', exact: true })).toBeVisible({
            timeout: 10_000,
        })

        // Ensure focus is on body, not an input that would suppress shortcuts.
        await page.evaluate(() => {
            ;(document.activeElement as HTMLElement | null)?.blur?.()
        })

        // The help shortcut binds to `Shift+?` because on real keyboards producing
        // a `?` always holds Shift. Playwright's press('?') fires the event with
        // shiftKey=false, so use the explicit combo to match what a human types.
        await page.keyboard.press('Shift+?')
        await expect(page.getByText('Keyboard shortcuts').first()).toBeVisible({ timeout: 5_000 })

        await page.keyboard.press('Escape')
        await expect(page.getByText('Keyboard shortcuts').first()).not.toBeVisible({
            timeout: 5_000,
        })
    })

    test('t o jumps to contacts', async ({ page }) => {
        test.skip(!mailLinked || !contactsLinked, 'mail + contacts packages not linked')
        await navigateToPackage(page, 'mail')
        // Wait for the rail link to render so the shortcut provider has mounted
        // and tinykeys has bound its listeners before we start typing.
        await expect(page.getByRole('link', { name: 'Mail', exact: true })).toBeVisible({
            timeout: 10_000,
        })

        // Ensure focus is on body, not an input that would suppress shortcuts.
        await page.evaluate(() => {
            ;(document.activeElement as HTMLElement | null)?.blur?.()
        })

        // Small delay between keys helps the sequence matcher — the two presses
        // must arrive within its 1s window but fast enough that neither is lost.
        await page.keyboard.press('t', { delay: 50 })
        await page.keyboard.press('o', { delay: 50 })
        await page.waitForURL(new RegExp(`/a/${ORG_SLUG}/contacts`), { timeout: 10_000 })
    })

    test('j/k move focus and Enter opens the focused mail row', async ({ page }) => {
        test.skip(!mailLinked, 'mail package not linked')
        await navigateToPackage(page, 'mail')
        await page.mouse.click(10, 10)
        await page.waitForSelector('[data-testid="email-row"]', { timeout: 10_000 })

        await page.keyboard.press('j')
        await page.keyboard.press('j')
        await page.keyboard.press('Enter')

        await page.waitForURL(new RegExp(`/a/${ORG_SLUG}/mail/[^/?]+`), { timeout: 5_000 })
    })
})
