import { expect, type Page, test } from '@playwright/test'
import { login, ORG_SLUG, TEST_USER_EMAIL, TEST_USER_PASSWORD } from '../../../../tests/e2e/helpers'
import {
    EDITOR_READY_TIMEOUT,
    editorRoot,
    FEATURE_DOC_HEADING,
    PB_URL,
    TEXT_TEST_TIMEOUT,
    uniqueDocName,
    uploadDocxAsDriveItem,
    waitForEditor,
} from './_menubar-helpers'

const TEST_TIMEOUT = TEXT_TEST_TIMEOUT

interface SecondUser {
    id: string
    email: string
    password: string
    userOrgId: string
}

// createSecondUser mints a fresh user via the superuser API and adds
// them to test-org. Used by the multi-user (presence + remote-edit)
// specs so each browser context has a distinct identity. Mirrors
// calendar's calendar-sharing.spec.ts pattern.
async function createSecondUser(): Promise<SecondUser> {
    const adminEmail = process.env.ADMIN_USER_LOGIN ?? 'admin@tinycld.org'
    const adminPassword = process.env.ADMIN_USER_PW ?? 'AdminPass1234!'

    const adminAuth = await fetch(`${PB_URL}/api/collections/_superusers/auth-with-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: adminEmail, password: adminPassword }),
    })
    if (!adminAuth.ok) {
        throw new Error(`Superuser auth failed: ${adminAuth.status} ${await adminAuth.text()}`)
    }
    const { token: adminToken } = (await adminAuth.json()) as { token: string }

    const orgsRes = await fetch(
        `${PB_URL}/api/collections/orgs/records?filter=${encodeURIComponent(`slug='${ORG_SLUG}'`)}`,
        { headers: { Authorization: adminToken } }
    )
    const orgs = (await orgsRes.json()) as { items: { id: string }[] }
    if (!orgs.items[0]) throw new Error(`Org ${ORG_SLUG} not found`)
    const orgId = orgs.items[0].id

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const email = `text-test-${suffix}@tinycld.org`
    const password = 'TextTest1234!'

    const userRes = await fetch(`${PB_URL}/api/collections/users/records`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: adminToken },
        body: JSON.stringify({
            email,
            password,
            passwordConfirm: password,
            name: `Text Tester ${suffix}`,
            username: `text_${suffix.replace(/-/g, '_')}`,
            verified: true,
        }),
    })
    if (!userRes.ok) {
        throw new Error(`Create user failed: ${userRes.status} ${await userRes.text()}`)
    }
    const user = (await userRes.json()) as { id: string }

    const userOrgRes = await fetch(`${PB_URL}/api/collections/user_org/records`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: adminToken },
        body: JSON.stringify({ user: user.id, org: orgId, role: 'member' }),
    })
    if (!userOrgRes.ok) {
        throw new Error(`Create user_org failed: ${userOrgRes.status} ${await userOrgRes.text()}`)
    }
    const userOrg = (await userOrgRes.json()) as { id: string }

    return { id: user.id, email, password, userOrgId: userOrg.id }
}

// shareDriveItemWith creates a drive_shares row giving `user.userOrgId`
// editor access to `itemId`. Goes through the superuser API so we don't
// have to drive the in-app share UI for every test.
async function shareDriveItemWith(itemId: string, user: SecondUser): Promise<void> {
    const adminEmail = process.env.ADMIN_USER_LOGIN ?? 'admin@tinycld.org'
    const adminPassword = process.env.ADMIN_USER_PW ?? 'AdminPass1234!'
    const adminAuth = await fetch(`${PB_URL}/api/collections/_superusers/auth-with-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: adminEmail, password: adminPassword }),
    })
    const { token: adminToken } = (await adminAuth.json()) as { token: string }

    const res = await fetch(`${PB_URL}/api/collections/drive_shares/records`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: adminToken },
        body: JSON.stringify({
            item: itemId,
            user_org: user.userOrgId,
            role: 'editor',
            created_by: user.userOrgId,
        }),
    })
    if (!res.ok) {
        throw new Error(`Share drive_item failed: ${res.status} ${await res.text()}`)
    }
}

async function loginAs(page: Page, identifier: string, password: string): Promise<void> {
    await page.goto('/')
    await page.getByTestId('identifier').fill(identifier)
    await page.getByPlaceholder('Password').fill(password)
    await page.getByText('Sign in', { exact: true }).last().click()
    await page.waitForURL(/\/a\//, { timeout: 15_000 })
}

test.describe('Text — Document editor', () => {
    test.setTimeout(TEST_TIMEOUT)

    test('create from drive: upload .docx then open in Text loads the editor', async ({ page }) => {
        // The plan's spec text is "upload via drive UI -> Open in Text".
        // We collapse that to "upload via REST + navigate" because the
        // upload UI flow (drag-drop or file picker, wait for thumbnail,
        // right-click → Open in Text) is brittle and the value of the
        // assertion is "the bootstrap parses a real .docx and seeds the
        // Y.Doc end to end". The REST upload exercises the same hook
        // path drive's UploadButton would.
        const itemId = await uploadDocxAsDriveItem(uniqueDocName('feature'))

        await login(page)
        await page.goto(`/a/${ORG_SLUG}/text/${itemId}`)

        await waitForEditor(page)
        // The fixture's H1 should land in the editor after the bootstrap
        // parses + seeds + the Tiptap binding catches up.
        await expect(page.getByText(FEATURE_DOC_HEADING).first()).toBeVisible({
            timeout: EDITOR_READY_TIMEOUT,
        })
    })

    test('edit and persist: typed text survives reload', async ({ page }) => {
        const itemId = await uploadDocxAsDriveItem(uniqueDocName('persist'))
        await login(page)
        await page.goto(`/a/${ORG_SLUG}/text/${itemId}`)
        await waitForEditor(page)
        await expect(page.getByText(FEATURE_DOC_HEADING).first()).toBeVisible({
            timeout: EDITOR_READY_TIMEOUT,
        })

        // Type a unique marker the reload will look for. Use the suffix
        // to keep it unique across parallel runs / re-runs.
        const marker = `persist-marker-${Date.now()}`
        await editorRoot(page).click()
        await page.keyboard.press('End')
        await page.keyboard.press('Enter')
        await page.keyboard.type(marker)

        // Wait past the broker's flush debounce. The runtime's flush
        // throttle is short (a few seconds); 6s is comfortably beyond it
        // and below the per-spec timeout.
        await page.waitForTimeout(6_000)

        await page.reload()
        await waitForEditor(page)
        await expect(page.getByText(marker)).toBeVisible({ timeout: EDITOR_READY_TIMEOUT })
    })

    test('round-trip integrity: bold + heading + bullet list survive reload', async ({ page }) => {
        const itemId = await uploadDocxAsDriveItem(uniqueDocName('roundtrip'))
        await login(page)
        await page.goto(`/a/${ORG_SLUG}/text/${itemId}`)
        await waitForEditor(page)
        await expect(page.getByText(FEATURE_DOC_HEADING).first()).toBeVisible({
            timeout: EDITOR_READY_TIMEOUT,
        })

        // Move to a fresh paragraph at the end and apply each formatting
        // feature in sequence. Marker strings let us locate them after
        // reload — simply asserting on "is bold" without unique anchor
        // text would risk colliding with the fixture's existing bold runs.
        const stamp = Date.now()
        const boldMarker = `bold-mark-${stamp}`
        const h2Marker = `h2-mark-${stamp}`
        const listMarker = `list-mark-${stamp}`

        await editorRoot(page).click()
        await page.keyboard.press('End')

        // Bold
        await page.keyboard.press('Enter')
        await page.getByRole('button', { name: 'Bold' }).click()
        await page.keyboard.type(boldMarker)
        await page.getByRole('button', { name: 'Bold' }).click()

        // Heading 2
        await page.keyboard.press('Enter')
        await page.getByRole('button', { name: 'Heading 2', exact: true }).click()
        await page.keyboard.type(h2Marker)

        // Bullet list (returning to a paragraph context first via Enter)
        await page.keyboard.press('Enter')
        await page.getByRole('button', { name: 'Bullet list' }).click()
        await page.keyboard.type(listMarker)

        // Wait past flush window then reload.
        await page.waitForTimeout(6_000)
        await page.reload()
        await waitForEditor(page)

        // Each marker should be present in the rendered DOM. We don't
        // assert *which* tag wraps it — the broker round-trip is what's
        // under test here, not the exact DOM structure.
        await expect(page.getByText(boldMarker)).toBeVisible({ timeout: EDITOR_READY_TIMEOUT })
        await expect(page.getByText(h2Marker)).toBeVisible()
        await expect(page.getByText(listMarker)).toBeVisible()
    })

    test('presence avatars: second user appears in first user view', async ({ browser }) => {
        const itemId = await uploadDocxAsDriveItem(uniqueDocName('presence'))
        const userB = await createSecondUser()
        await shareDriveItemWith(itemId, userB)

        const ctxA = await browser.newContext()
        const ctxB = await browser.newContext()
        try {
            const pageA = await ctxA.newPage()
            const pageB = await ctxB.newPage()

            await loginAs(pageA, TEST_USER_EMAIL, TEST_USER_PASSWORD)
            await pageA.goto(`/a/${ORG_SLUG}/text/${itemId}`)
            await waitForEditor(pageA)

            await loginAs(pageB, userB.email, userB.password)
            await pageB.goto(`/a/${ORG_SLUG}/text/${itemId}`)
            await waitForEditor(pageB)

            // Each PresenceAvatars Avatar carries
            // accessibilityLabel={user.name}, which renders to
            // aria-label on web. The "+N" overflow badge has no aria
            // role/label so a getByLabel match is unambiguous.
            await expect(pageA.getByLabel(/Text Tester/).first()).toBeVisible({
                timeout: EDITOR_READY_TIMEOUT,
            })
        } finally {
            await ctxA.close()
            await ctxB.close()
        }
    })

    test('remote edits: typing in user A appears in user B', async ({ browser }) => {
        const itemId = await uploadDocxAsDriveItem(uniqueDocName('remote'))
        const userB = await createSecondUser()
        await shareDriveItemWith(itemId, userB)

        const ctxA = await browser.newContext()
        const ctxB = await browser.newContext()
        try {
            const pageA = await ctxA.newPage()
            const pageB = await ctxB.newPage()

            await loginAs(pageA, TEST_USER_EMAIL, TEST_USER_PASSWORD)
            await pageA.goto(`/a/${ORG_SLUG}/text/${itemId}`)
            await waitForEditor(pageA)
            await expect(pageA.getByText(FEATURE_DOC_HEADING).first()).toBeVisible({
                timeout: EDITOR_READY_TIMEOUT,
            })

            await loginAs(pageB, userB.email, userB.password)
            await pageB.goto(`/a/${ORG_SLUG}/text/${itemId}`)
            await waitForEditor(pageB)
            await expect(pageB.getByText(FEATURE_DOC_HEADING).first()).toBeVisible({
                timeout: EDITOR_READY_TIMEOUT,
            })

            // A types a unique marker; B should observe it via the
            // Y.Doc → broker → SyncReply path. The plan's "within 1s"
            // budget is the perf goal, not a hard test bound — use a
            // generous 10s so the assertion isn't flaky under
            // worker-contention slowness.
            const marker = `remote-marker-${Date.now()}`
            await editorRoot(pageA).click()
            await pageA.keyboard.press('End')
            await pageA.keyboard.press('Enter')
            await pageA.keyboard.type(marker)

            await expect(pageB.getByText(marker)).toBeVisible({ timeout: 10_000 })
        } finally {
            await ctxA.close()
            await ctxB.close()
        }
    })

    test.skip('import warning banner: tracked-changes .docx surfaces a banner', async () => {
        // Requires a user-provided fixture .docx with tracked
        // changes (Word's Review → Track Changes mode). Authoring
        // that fixture is out of scope for the v1 spec landing —
        // ImportWarningBanner already has unit coverage in
        // tests/import-warning-banner.test.tsx; what's missing is an
        // end-to-end fixture that triggers the
        // translate.DocxToPMJSON warning path.
    })

    test.skip('save failure indicator: SaveStatusIndicator flips to "Save failed"', async () => {
        // Requires a server-side test hook to deterministically
        // force a flush failure (e.g. inject a write error in the
        // text broker's save pipeline). Adding the hook is a v2
        // refactor; for v1 the SaveStatusIndicator is unit-tested
        // in core's editor suite and the production path is
        // exercised by every passing edit-and-persist run above.
    })
})
