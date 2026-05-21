import type { Locator, Page } from '@playwright/test'
import { expect } from '@playwright/test'
import { ORG_SLUG, TEST_USER_EMAIL, TEST_USER_PASSWORD } from '../../../../tests/e2e/helpers'

// Drive uses FrozenSlideStack inside its package layout, so navigating
// from /drive → /drive/folder/<id> → another folder keeps every prior
// folder screen mounted in the DOM. A bare `getByText('Projects')` will
// match hidden snapshots in those frozen routes alongside the active
// screen, and `.first()` may resolve to whichever one rendered first.
//
// driveItem is the row-level locator scoped to *visible* DOM, anchored
// on the package's grid/list row aria-label format
// (`<name> <Month D, YYYY>`).
export function driveItem(page: Page, name: string | RegExp): Locator {
    const namePattern = typeof name === 'string' ? new RegExp(`^${escapeRegex(name)} `) : name
    return page.getByRole('button', { name: namePattern }).filter({ visible: true }).first()
}

export async function openDriveItem(page: Page, name: string | RegExp) {
    await dismissErrorOverlay(page)
    const item = driveItem(page, name)
    await expect(item).toBeVisible({ timeout: 10_000 })
    await item.click()
}

export async function dismissErrorOverlay(page: Page) {
    const dismiss = page.getByRole('button', { name: 'Dismiss error' })
    if ((await dismiss.count()) > 0 && (await dismiss.first().isVisible())) {
        await dismiss
            .first()
            .click()
            .catch(() => {
                /* overlay already gone */
            })
    }
}

export function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// PB sits behind the dev.ts proxy on the test Expo port. /api/* routes
// through to PB transparently — see scripts/dev.ts::isPbPath.
const PB_URL = 'http://127.0.0.1:7200'

let cachedAuthToken: string | null = null
let cachedOrgContext: { orgId: string; userOrgId: string } | null = null

async function authAsTestUser(): Promise<string> {
    if (cachedAuthToken) return cachedAuthToken
    const res = await fetch(`${PB_URL}/api/collections/users/auth-with-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: TEST_USER_EMAIL, password: TEST_USER_PASSWORD }),
    })
    if (!res.ok) {
        throw new Error(`PB auth failed: ${res.status} ${await res.text()}`)
    }
    const { token } = (await res.json()) as { token: string }
    cachedAuthToken = token
    return token
}

async function resolveOrgContext(token: string): Promise<{ orgId: string; userOrgId: string }> {
    if (cachedOrgContext) return cachedOrgContext
    const me = await fetch(`${PB_URL}/api/collections/users/auth-refresh`, {
        method: 'POST',
        headers: { Authorization: token },
    })
    const meBody = (await me.json()) as { record?: { id: string } }
    const userId = meBody.record?.id
    if (!userId) throw new Error(`auth-refresh returned no user record`)

    const orgs = await fetch(
        `${PB_URL}/api/collections/orgs/records?filter=${encodeURIComponent(`slug='${ORG_SLUG}'`)}`,
        { headers: { Authorization: token } }
    )
    const orgItems = (await orgs.json()) as { items: { id: string }[] }
    if (!orgItems.items[0]) throw new Error(`Org ${ORG_SLUG} not found`)
    const orgId = orgItems.items[0].id

    const userOrgs = await fetch(
        `${PB_URL}/api/collections/user_org/records?filter=${encodeURIComponent(
            `org='${orgId}' && user='${userId}'`
        )}`,
        { headers: { Authorization: token } }
    )
    const userOrgItems = (await userOrgs.json()) as { items: { id: string }[] }
    if (!userOrgItems.items[0]) throw new Error(`user_org for ${ORG_SLUG} not found`)
    cachedOrgContext = { orgId, userOrgId: userOrgItems.items[0].id }
    return cachedOrgContext
}

export async function authTokenForTestUser(): Promise<string> {
    return authAsTestUser()
}

export async function testUserOrgContext(): Promise<{ orgId: string; userOrgId: string }> {
    const token = await authAsTestUser()
    return resolveOrgContext(token)
}

// Create a drive_items record via the PB REST API. Tests that need a
// fixture file/folder to mutate should create one here so they don't
// race seed reads.
export async function createDriveItem(opts: {
    name: string
    parent?: string
    isFolder?: boolean
}): Promise<{ id: string; name: string }> {
    const token = await authAsTestUser()
    const { orgId, userOrgId } = await resolveOrgContext(token)
    const res = await fetch(`${PB_URL}/api/collections/drive_items/records`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: token },
        body: JSON.stringify({
            org: orgId,
            created_by: userOrgId,
            parent: opts.parent ?? '',
            name: opts.name,
            is_folder: opts.isFolder ?? false,
            size: 0,
        }),
    })
    if (!res.ok) {
        throw new Error(`Create drive_item failed: ${res.status} ${await res.text()}`)
    }
    const created = (await res.json()) as { id: string; name: string }
    return created
}

export async function findDriveItemByName(opts: {
    name: string
    parent?: string
}): Promise<{ id: string } | null> {
    const token = await authAsTestUser()
    const { orgId } = await resolveOrgContext(token)
    const filter = `org='${orgId}' && name='${opts.name}' && parent='${opts.parent ?? ''}'`
    const res = await fetch(
        `${PB_URL}/api/collections/drive_items/records?filter=${encodeURIComponent(filter)}`,
        { headers: { Authorization: token } }
    )
    if (!res.ok) return null
    const body = (await res.json()) as { items: { id: string }[] }
    return body.items[0] ?? null
}
