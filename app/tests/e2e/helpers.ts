import * as fs from 'node:fs'
import * as path from 'node:path'
import type { Page } from '@playwright/test'

export const ORG_SLUG = 'test-org'
export const TEST_USER_EMAIL = process.env.TEST_USER_LOGIN || 'user@tinycld.org'
export const TEST_USER_PASSWORD = process.env.TEST_USER_PW || 'TestUser1234!'
export const TEST_USER_USERNAME = process.env.TEST_USER_USERNAME ?? 'tester'

// isPackageLinked checks whether a given @tinycld/* package is wired into
// this core checkout. Tests that depend on package-contributed routes or
// collections should guard with `test.skip(!isPackageLinked('mail'), ...)`
// so they run when the package is linked (dev/package CI) and are skipped
// when core runs standalone (core's own CI).
export function isPackageLinked(slug: string): boolean {
    const corePackagesDir = path.resolve(import.meta.dirname, '..', '..', 'packages')
    return (
        fs.existsSync(path.join(corePackagesDir, '@tinycld', slug)) ||
        fs.existsSync(path.join(corePackagesDir, slug))
    )
}

export async function login(page: Page) {
    await page.goto('/')
    await page.getByTestId('identifier').fill(TEST_USER_EMAIL)
    await page.getByPlaceholder('Password').fill(TEST_USER_PASSWORD)
    await page.getByText('Sign in', { exact: true }).last().click()
    await page.waitForURL(/\/a\//, { timeout: 15_000 })
}

export async function navigateToPackage(page: Page, pkg: string) {
    await page.goto(`/a/${ORG_SLUG}/${pkg}`)
    await page.waitForLoadState('domcontentloaded')
}

export async function clickSidebarItem(page: Page, label: string) {
    await page.getByText(label, { exact: true }).click()
}
