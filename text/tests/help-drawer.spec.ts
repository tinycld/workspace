import { expect, test } from '@playwright/test'
import { ORG_SLUG } from '../../../../tests/e2e/helpers'
import {
    EDITOR_REACTION_TIMEOUT,
    editorRoot,
    openFreshTextDocument,
    openMenubarMenu,
    TEXT_TEST_TIMEOUT,
} from './_menubar-helpers'

// Help drawer package-index mode: the Help menu's "Browse text help"
// item now opens an in-app drawer with a topic list (no route change).
// Selecting a topic switches the drawer to topic mode with a back
// arrow; the back arrow returns to the package list without remount.
// A subtle "Read all tinycld help" link in both modes navigates to
// the routed /a/<org>/help hub and dismisses the drawer.
//
// NOT EXECUTED IN CI for this PR — the main session validates after
// merging into the text package's main branch.

test.describe('Text — Help drawer package-index mode', () => {
    test.setTimeout(TEXT_TEST_TIMEOUT)

    test('Help → Browse text help opens the drawer with the text topic list', async ({ page }) => {
        await openFreshTextDocument(page, 'help-drawer-open')
        await editorRoot(page).click()

        await openMenubarMenu(page, 'Help')
        await page.getByRole('menuitem', { name: 'Browse text help' }).click()

        // The drawer is up with the package's topic list. At minimum we
        // expect a couple of well-known text topics to be visible as row
        // titles: the slash-menu topic ("Inserting blocks with the slash
        // menu") and the templates topic ("Starting a document from a
        // template"). Match on stable substrings of the real frontmatter
        // titles — see text/help/*.md. The drawer hydrates its list from
        // the generated help registry, which can lag a beat under worker
        // contention, so wait the reaction budget rather than the implicit
        // 5s default.
        await expect(page.getByText(/slash menu/i).first()).toBeVisible({
            timeout: EDITOR_REACTION_TIMEOUT,
        })
        await expect(page.getByText(/from a template/i).first()).toBeVisible({
            timeout: EDITOR_REACTION_TIMEOUT,
        })
    })

    test('clicking a row switches to topic mode and shows a back arrow', async ({ page }) => {
        await openFreshTextDocument(page, 'help-drawer-row')
        await editorRoot(page).click()

        await openMenubarMenu(page, 'Help')
        await page.getByRole('menuitem', { name: 'Browse text help' }).click()

        // Click the row's accessible button (PackageTopicList renders each
        // row as a Pressable with accessibilityLabel "Open help topic: …")
        // rather than the inner title <Text> — clicking the button element
        // directly drives the same navigateToTopic handler that records
        // cameFrom, which the back arrow depends on.
        const templatesRow = page.getByRole('button', {
            name: /Open help topic:.*from a template/i,
        })
        await expect(templatesRow).toBeVisible({ timeout: EDITOR_REACTION_TIMEOUT })
        await templatesRow.click()

        // Topic body is now showing — assert on text from the rendered
        // markdown. Every templates topic mentions "template" repeatedly.
        await expect(page.getByText(/template/i).first()).toBeVisible({
            timeout: EDITOR_REACTION_TIMEOUT,
        })

        const backArrow = page.getByRole('button', { name: 'Back to package help' })
        await expect(backArrow).toBeVisible({ timeout: EDITOR_REACTION_TIMEOUT })
    })

    test('back arrow returns to the package list without leaving the drawer', async ({ page }) => {
        await openFreshTextDocument(page, 'help-drawer-back')
        await editorRoot(page).click()

        await openMenubarMenu(page, 'Help')
        await page.getByRole('menuitem', { name: 'Browse text help' }).click()
        const templatesRow = page.getByRole('button', {
            name: /Open help topic:.*from a template/i,
        })
        await expect(templatesRow).toBeVisible({ timeout: EDITOR_REACTION_TIMEOUT })
        await templatesRow.click()

        const backArrow = page.getByRole('button', { name: 'Back to package help' })
        await expect(backArrow).toBeVisible({ timeout: EDITOR_REACTION_TIMEOUT })
        await backArrow.click()

        // The slash-menu row is once again visible — same package
        // index we came from, no route change.
        await expect(page.getByText(/slash menu/i).first()).toBeVisible({
            timeout: EDITOR_REACTION_TIMEOUT,
        })
    })

    test('"Read all tinycld help" navigates to the routed hub and dismisses the drawer', async ({
        page,
    }) => {
        await openFreshTextDocument(page, 'help-drawer-readall')
        await editorRoot(page).click()

        await openMenubarMenu(page, 'Help')
        await page.getByRole('menuitem', { name: 'Browse text help' }).click()

        await page.getByText(/Read all tinycld help/i).click()

        await expect(page).toHaveURL(new RegExp(`/a/${ORG_SLUG}/help`))
        // The drawer dismissed. Asserting on the body text won't work
        // because the destination /help page also lists the text
        // package's topics — checking for the "Read all" link itself
        // (a drawer-only affordance) is the right signal.
        await expect(page.getByRole('link', { name: /Read all tinycld help/i })).toHaveCount(0)
    })
})
