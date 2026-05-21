import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '../../../../tests/e2e/helpers'
import { dismissErrorOverlay, driveItem, openDriveItem } from './helpers'

// Drive-1 reads seeded folder structure (Projects, Engineering, Personal,
// Archive). drive-2 used to delete + rename seeded *files* under those
// folders, racing with these reads. drive-2 has been switched to
// per-test fixture files, so the seeded folder skeleton stays stable
// for these reads.

test.describe('Drive — Browser', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'drive')
        await dismissErrorOverlay(page)
    })

    test('navigate into folder with single click (list view)', async ({ page }) => {
        await openDriveItem(page, 'Projects')

        await expect(driveItem(page, 'Q1 Planning')).toBeVisible({ timeout: 10_000 })
        await expect(driveItem(page, 'Marketing')).toBeVisible()
        await expect(driveItem(page, 'Engineering')).toBeVisible()
    })

    test('navigate into folder with single click (grid view)', async ({ page }) => {
        await expect(driveItem(page, 'Projects')).toBeVisible({ timeout: 10_000 })
        await page.getByTestId('drive-view-grid').click()
        await expect(page.getByText('Folders', { exact: true }).first()).toBeVisible({
            timeout: 5_000,
        })

        await openDriveItem(page, 'Projects')

        await expect(driveItem(page, 'Q1 Planning')).toBeVisible({ timeout: 10_000 })
    })

    test('breadcrumb navigation', async ({ page }) => {
        await openDriveItem(page, 'Projects')
        await expect(driveItem(page, 'Q1 Planning')).toBeVisible({ timeout: 10_000 })

        await openDriveItem(page, 'Engineering')
        await expect(driveItem(page, 'Q1 Planning')).not.toBeVisible({ timeout: 5_000 })

        const myFiles = page.getByText('My Files')
        await myFiles.first().click()
        await expect(driveItem(page, 'Projects')).toBeVisible({ timeout: 10_000 })
    })

    test('clicking a single file does not replace the breadcrumb header', async ({ page }) => {
        // Navigate to an Engineering subfolder; there's always at least one
        // file in there (the seed always wires up an Architecture or
        // similar fixture) — but rather than reading a specific seeded
        // filename (which other tests may rename), find the first
        // non-folder row in the list and operate on it.
        await openDriveItem(page, 'Projects')
        await expect(driveItem(page, 'Q1 Planning')).toBeVisible({ timeout: 10_000 })
        await openDriveItem(page, 'Engineering')

        // Wait for the folder to populate, then pick the first row.
        await expect(page.getByRole('button').first()).toBeVisible({ timeout: 10_000 })
        const firstRow = page
            .getByRole('button')
            .filter({ visible: true })
            .filter({ hasText: /\.[a-z]{2,4}\b/i })
            .first()
        await firstRow.click()

        // The folder-action "New folder" button is part of the normal
        // toolbar; it disappears when the selection toolbar takes over.
        await expect(page.getByRole('button', { name: 'New folder' })).toBeVisible()
    })

    test('selection toolbar appears only after multi-select', async ({ page }) => {
        await openDriveItem(page, 'Projects')
        await expect(driveItem(page, 'Q1 Planning')).toBeVisible({ timeout: 10_000 })
        await openDriveItem(page, 'Engineering')

        const fileRows = page
            .getByRole('button')
            .filter({ visible: true })
            .filter({ hasText: /\.[a-z]{2,4}\b/i })
        await expect(fileRows.first()).toBeVisible({ timeout: 10_000 })

        const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
        await fileRows.nth(0).click({ modifiers: [modifier] })
        await fileRows.nth(1).click({ modifiers: [modifier] })

        await expect(page.getByText(/2 selected|2 items/)).toBeVisible({ timeout: 5_000 })
    })

    test('storage indicator shows usage', async ({ page }) => {
        // The sidebar StorageBar has two render modes depending on whether a
        // per-user limit is configured (core settings.storage_limit_bytes):
        //   - with limit:    "X.XX GB of N GB used"
        //   - without limit: "X.XX GB used"
        // CI doesn't seed a limit, so the dev DB and CI hit different
        // branches. Match the substring common to both — the test's intent
        // is "the indicator renders," not "the indicator shows a specific
        // quota."
        await expect(page.getByText(/\d+(\.\d+)? GB used/)).toBeVisible()
    })
})

test.describe('Drive — Mobile', () => {
    test.use({ viewport: { width: 400, height: 800 } })

    test.beforeEach(async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'drive')
        await dismissErrorOverlay(page)
    })

    test('back button walks up nested folders', async ({ page }) => {
        await openDriveItem(page, 'Projects')
        await expect(driveItem(page, 'Engineering')).toBeVisible({ timeout: 10_000 })
        await openDriveItem(page, 'Engineering')

        const backButton = page.getByRole('button', { name: 'Go up' })
        await expect(backButton).toBeVisible({ timeout: 10_000 })
        await backButton.click()
        await expect(driveItem(page, 'Q1 Planning')).toBeVisible({ timeout: 10_000 })

        await expect(page.getByRole('button', { name: 'Go up' })).toBeVisible()
        await page.getByRole('button', { name: 'Go up' }).click()
        await expect(driveItem(page, 'Personal')).toBeVisible({ timeout: 10_000 })
    })
})
