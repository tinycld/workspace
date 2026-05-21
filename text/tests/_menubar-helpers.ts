import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, type Locator, type Page } from '@playwright/test'
import { login, ORG_SLUG, TEST_USER_EMAIL, TEST_USER_PASSWORD } from '../../../../tests/e2e/helpers'

// Realtime sync + .docx parse + Y.Doc bootstrap blows past the default
// 30s under worker contention.
export const TEXT_TEST_TIMEOUT = 120_000

export const PB_URL = 'http://127.0.0.1:7200'

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export const FEATURE_DOC_HEADING = 'Sample Document'

// Editor readiness budget. Mounting the editor requires: REST upload →
// drive create-hook → realtime room open → server parses the docx →
// seeds the Y.Doc → SyncReply → Tiptap binds. End to end that runs well
// under 30s on an idle machine but can approach a minute when several
// realtime rooms are booting at once, so callers wait this long for the
// `.ProseMirror` host and the fixture heading.
export const EDITOR_READY_TIMEOUT = 60_000

// Budget for assertions that wait on an editor-driven DOM change after a
// toolbar/menu click — e.g. a NodeView re-render writing `data-wrap`, or
// a popover/toolbar mounting. These were previously written with 2s–5s
// timeouts on the assumption that "Yjs/PM transactions are sync within a
// single click". That assumption holds on an idle machine but NOT under
// parallel-worker CPU/IO starvation: the PM transaction is synchronous,
// but the React NodeView re-render that paints the attribute is not, and
// the realtime broker servicing every worker's room can stall the
// microtask queue. A single shared, generous budget removes the whole
// class of "attribute didn't land in 2s" flakes without masking a real
// regression (a genuinely broken command never lands the attribute at
// all, so the test still fails — it just takes longer to do so).
export const EDITOR_REACTION_TIMEOUT = 15_000

interface OrgContext {
    orgId: string
    userOrgId: string
    userId: string
}

let cachedAuthToken: string | null = null
let cachedOrgContext: OrgContext | null = null

export async function authAsTestUser(): Promise<string> {
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

async function resolveOrgContext(token: string): Promise<OrgContext> {
    if (cachedOrgContext) return cachedOrgContext
    const me = await fetch(`${PB_URL}/api/collections/users/auth-refresh`, {
        method: 'POST',
        headers: { Authorization: token },
    })
    const meBody = (await me.json()) as { record?: { id: string } }
    const userId = meBody.record?.id
    if (!userId) throw new Error('auth-refresh returned no user record')

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
    cachedOrgContext = { orgId, userOrgId: userOrgItems.items[0].id, userId }
    return cachedOrgContext
}

// Collision-proof unique document name. drive_items treats
// (org, parent, name) as unique, so two parallel workers uploading in
// the same millisecond with a bare `Date.now()` would collide and the
// second create would 400 — surfacing as a misleading "editor never
// loaded" timeout downstream. Appending a random suffix removes the
// same-millisecond collision window entirely.
export function uniqueDocName(label: string): string {
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    return `${label}-${unique}.docx`
}

// Uploads tests/assets/feature-test.docx as a fresh drive_items row
// owned by the seeded test user. Returns the new row id, which is
// also the URL segment under /a/<org>/text/<id>.
export async function uploadDocxAsDriveItem(name: string): Promise<string> {
    const token = await authAsTestUser()
    const ctx = await resolveOrgContext(token)
    const fixturePath = join(import.meta.dirname, 'assets', 'feature-test.docx')
    const bytes = readFileSync(fixturePath)
    const form = new FormData()
    form.append('org', ctx.orgId)
    form.append('name', name)
    form.append('is_folder', 'false')
    form.append('mime_type', DOCX_MIME)
    form.append('parent', '')
    form.append('created_by', ctx.userOrgId)
    form.append('size', String(bytes.length))
    form.append('file', new Blob([new Uint8Array(bytes)], { type: DOCX_MIME }), name)
    const res = await fetch(`${PB_URL}/api/collections/drive_items/records`, {
        method: 'POST',
        headers: { Authorization: token },
        body: form,
    })
    if (!res.ok) {
        throw new Error(`Upload drive_item failed: ${res.status} ${await res.text()}`)
    }
    const body = (await res.json()) as { id: string }
    return body.id
}

export function editorRoot(page: Page): Locator {
    return page.locator('.tinycld-document-editor .ProseMirror')
}

export async function waitForEditor(page: Page, timeout = EDITOR_READY_TIMEOUT): Promise<void> {
    await expect(editorRoot(page)).toBeVisible({ timeout })
}

// Opens a freshly-uploaded text document and waits for the editor to be
// ready, including the fixture's H1 (the deterministic "Y.Doc seeded +
// Tiptap bound" signal — once it renders, every command path the specs
// drive is live). Each spec gets its own document so destructive items
// (Rename, Move to trash, Make a copy) can't poison siblings, and so a
// comment/edit from one scenario can't leak into another's view.
export async function openTextDocument(page: Page, label: string): Promise<string> {
    const itemId = await uploadDocxAsDriveItem(uniqueDocName(label))
    await login(page)
    await page.goto(`/a/${ORG_SLUG}/text/${itemId}`)
    await waitForEditor(page)
    await expect(page.getByText(FEATURE_DOC_HEADING).first()).toBeVisible({
        timeout: EDITOR_READY_TIMEOUT,
    })
    return itemId
}

// Backwards-compatible alias. Older specs import this name.
export const openFreshTextDocument = openTextDocument

// Clicks a top-level menubar button (File, Edit, Insert, Format, Help).
// `exact: true` matters because items inside the menus repeat the same
// label (e.g. Edit menu has no nested "Edit" but a stricter match makes
// the helper safe to reuse across menus).
export async function openMenubarMenu(page: Page, label: string): Promise<void> {
    await page.getByRole('button', { name: label, exact: true }).click()
}
