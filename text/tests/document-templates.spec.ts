// document-templates.spec.ts exercises the "New from template" picker
// end-to-end. Opening the text index → clicking the picker trigger →
// verifying every shipping template card is visible → picking the
// Letter template → verifying the editor mounts with the expected
// salutation text in place. Mirrors text-document.spec.ts's timeout +
// login plumbing.
//
// NOT WIRED INTO CI YET — written but not run as part of this change;
// the task says "DO NOT RUN, just write it."

import { expect, type Page, test } from '@playwright/test'
import { login, ORG_SLUG } from '../../../../tests/e2e/helpers'

const TEST_TIMEOUT = 120_000

test.describe('Text — Document templates picker', () => {
    test.setTimeout(TEST_TIMEOUT)

    test('opens the picker, shows all four templates, creates from Letter', async ({ page }) => {
        await login(page)
        await page.goto(`/a/${ORG_SLUG}/text`)

        // The picker trigger lives next to the primary "New document"
        // button on the index header.
        const pickerTrigger = page.getByRole('button', { name: 'From template…' })
        await expect(pickerTrigger).toBeVisible()
        await pickerTrigger.click()

        // Verify every shipping template renders its card.
        await expect(
            page.getByRole('button', { name: /Create from template: Blank/ })
        ).toBeVisible()
        await expect(
            page.getByRole('button', { name: /Create from template: Letter/ })
        ).toBeVisible()
        await expect(
            page.getByRole('button', { name: /Create from template: Resume/ })
        ).toBeVisible()
        await expect(
            page.getByRole('button', { name: /Create from template: Report/ })
        ).toBeVisible()

        // Pick Letter — should kick off the upload + route to the new doc.
        await page.getByRole('button', { name: /Create from template: Letter/ }).click()

        await expectRoutedToNewDoc(page)

        // Once the editor is mounted, the Letter template's "Dear" line is
        // visible inside the editor surface.
        await expect(page.getByText(/Dear \[Recipient Name\]/).first()).toBeVisible({
            timeout: TEST_TIMEOUT,
        })
        // Closing salutation as a second anchor — guards against
        // overfitting to one phrase that future generator edits might
        // change while still keeping the salutation/sign-off pair.
        await expect(page.getByText(/Sincerely,/).first()).toBeVisible({
            timeout: TEST_TIMEOUT,
        })
    })
})

async function expectRoutedToNewDoc(page: Page) {
    await page.waitForURL(url => /\/text\/[A-Za-z0-9]+$/.test(url.pathname), {
        timeout: TEST_TIMEOUT,
    })
}
