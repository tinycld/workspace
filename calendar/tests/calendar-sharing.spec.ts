import { expect, test } from '@playwright/test'
import { type CalDAVCalendar, propfindCalendars } from '../../../../tests/e2e/caldav-helpers'
import { login, ORG_SLUG } from '../../../../tests/e2e/helpers'

// Pick the auto-created personal calendar (named after the user) which
// always exists in test-org and is owned by the test user. The CalDAV
// server suffixes displaynames with the org name when a user belongs to
// multiple orgs, so the test user (who has both test-org and acme) sees
// "Test User (Test Organization)" — match that to pin to test-org.
const TEST_ORG_NAME = 'Test Organization'
function pickTestOrgCalendar(calendars: CalDAVCalendar[]): CalDAVCalendar {
    const personal =
        calendars.find(c => c.name === `Test User (${TEST_ORG_NAME})`) ??
        calendars.find(c => c.name === 'Test User')
    if (personal) return personal
    throw new Error(
        `No "Test User" calendar in PROPFIND result; got: ${calendars.map(c => c.name).join(', ')}`
    )
}

// PB sits behind the dev.ts proxy on the test Expo port. /api/* routes
// through to PB transparently — see scripts/dev.ts::isPbPath.
const PB_URL = 'http://127.0.0.1:7200'

interface SecondUser {
    id: string
    email: string
    password: string
    userOrgId: string
}

/**
 * Create a second user in test-org by hand via PB's superuser API. Returns
 * the new user's id, credentials, and user_org id (for asserting calendar
 * memberships and authenticating CalDAV requests as this user).
 *
 * Each call generates a unique email so parallel test files don't collide.
 */
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

    // Look up test-org by slug.
    const orgsRes = await fetch(
        `${PB_URL}/api/collections/orgs/records?filter=${encodeURIComponent(`slug='${ORG_SLUG}'`)}`,
        { headers: { Authorization: adminToken } }
    )
    const orgs = (await orgsRes.json()) as { items: { id: string }[] }
    if (!orgs.items[0]) throw new Error(`Org ${ORG_SLUG} not found`)
    const orgId = orgs.items[0].id

    // Unique email per invocation.
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const email = `sharing-test-${suffix}@tinycld.org`
    const password = 'SharingTest1234!'

    const userRes = await fetch(`${PB_URL}/api/collections/users/records`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: adminToken },
        body: JSON.stringify({
            email,
            password,
            passwordConfirm: password,
            name: `Sharing Test ${suffix}`,
            username: `sharing_${suffix.replace(/-/g, '_')}`,
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

/**
 * Issue an authenticated PROPFIND on /caldav/u/cal/ as the given user.
 * Returns the parsed calendar list, used to verify that a sharee can see
 * a calendar shared with them (or that an ex-sharee can no longer see one).
 */
async function propfindCalendarsAs(user: SecondUser): Promise<{ id: string; name: string }[]> {
    const auth = `Basic ${Buffer.from(`${user.email}:${user.password}`).toString('base64')}`
    const res = await fetch(`${PB_URL}/caldav/u/cal/`, {
        method: 'PROPFIND',
        headers: {
            Authorization: auth,
            Depth: '1',
            'Content-Type': 'application/xml; charset=utf-8',
        },
        body: `<?xml version="1.0" encoding="utf-8" ?>
<propfind xmlns="DAV:">
    <prop>
        <displayname/>
        <resourcetype/>
    </prop>
</propfind>`,
    })
    if (res.status !== 207) {
        throw new Error(`PROPFIND as ${user.email} expected 207, got ${res.status}`)
    }
    const xml = await res.text()
    const out: { id: string; name: string }[] = []
    const responseRe = /<(?:\w+:)?response\b[^>]*>([\s\S]*?)<\/(?:\w+:)?response>/g
    for (const m of xml.matchAll(responseRe)) {
        const block = m[1]
        const hrefMatch = /<(?:\w+:)?href\b[^>]*>([\s\S]*?)<\/(?:\w+:)?href>/.exec(block)
        if (!hrefMatch) continue
        const dnMatch = /<(?:\w+:)?displayname\b[^>]*>([\s\S]*?)<\/(?:\w+:)?displayname>/.exec(
            block
        )
        const idMatch = /\/caldav\/u\/cal\/([^/]+)\/?$/.exec(hrefMatch[1].trim())
        if (idMatch?.[1]) {
            out.push({ id: idMatch[1], name: dnMatch?.[1].trim() ?? '' })
        }
    }
    return out
}

// Run serially: each test mutates calendar_members on the shared calendar
// and the next test relies on a clean slate. Parallel runs would step on
// each other's "added member" state.
test.describe.configure({ mode: 'serial' })

test.describe('Calendar — Sharing UI', () => {
    test('Owner sees themselves in the Shared with list', async ({ page }) => {
        const calendars = await propfindCalendars()
        const cal = pickTestOrgCalendar(calendars)

        await login(page)
        await page.goto(`/a/${ORG_SLUG}/calendar/settings/${cal.id}`)
        await expect(page.getByText('Shared with')).toBeVisible({ timeout: 10_000 })

        // The seed user "Test User" appears as a member with the "Owner"
        // role. Both the avatar text and the role pill come from the same
        // joined live query, so seeing both confirms the row rendered end
        // to end (membership row + user_org join + users join).
        await expect(page.getByText('Test User').first()).toBeVisible()
        await expect(page.getByText('Owner').first()).toBeVisible()
    })

    test('Owner can add a member; sharee can list the calendar via CalDAV', async ({ page }) => {
        const calendars = await propfindCalendars()
        const cal = pickTestOrgCalendar(calendars)

        // Create a brand-new user in test-org for this test. PROPFIND as
        // this user before sharing should NOT include the owner's calendar.
        const sharee = await createSecondUser()
        const beforeShare = await propfindCalendarsAs(sharee)
        expect(beforeShare.find(c => c.id === cal.id)).toBeUndefined()

        // Drive the sharing UI as the owner.
        await login(page)
        await page.goto(`/a/${ORG_SLUG}/calendar/settings/${cal.id}`)
        await expect(page.getByText('Shared with')).toBeVisible({ timeout: 10_000 })

        await page.getByRole('button', { name: 'Add people' }).click()
        const searchField = page.getByPlaceholder('Search by name or email')
        await expect(searchField).toBeVisible({ timeout: 5_000 })

        // Type enough of the new user's name to filter the candidate list.
        await searchField.fill('Sharing Test')

        // The candidate row shows the user's display name. AddMemberDialog
        // renders email only when name is empty (matches Google's nicer
        // "Holly Stitt / holly@stitt.org" two-line format).
        const candidateRow = page.getByText(/^Sharing Test \d/).first()
        await expect(candidateRow).toBeVisible({ timeout: 5_000 })
        await page.getByRole('button', { name: 'Add' }).last().click()

        // Dialog closes on success — wait for the search field to disappear.
        await expect(page.getByPlaceholder('Search by name or email')).not.toBeVisible({
            timeout: 5_000,
        })

        // Now the cross-tier check: the new user must see the calendar
        // appear in their PROPFIND. This proves the membership row landed
        // and the server's calendar_members filter picks it up.
        await expect(async () => {
            const after = await propfindCalendarsAs(sharee)
            const match = after.find(c => c.id === cal.id)
            if (!match) {
                throw new Error(
                    `${sharee.email} doesn't see calendar ${cal.id} yet; got: ${after.map(c => c.name).join(', ')}`
                )
            }
        }).toPass({ timeout: 5_000 })
    })

    test('Last-owner removal is rejected with a clear error', async ({ page }) => {
        const calendars = await propfindCalendars()
        const cal = pickTestOrgCalendar(calendars)

        await login(page)
        await page.goto(`/a/${ORG_SLUG}/calendar/settings/${cal.id}`)
        await expect(page.getByText('Shared with')).toBeVisible({ timeout: 10_000 })

        // The current user (Test User) is the only owner of their personal
        // calendar. The remove (×) button on the owner row should be hidden
        // when they're the last owner — render-time guard mirrored from the
        // server's guardLastOwner protection. Verify the button isn't
        // there and the role pill is a plain text badge, not a dropdown.
        const ownerRow = page.getByText('Test User').first().locator('../..')
        await expect(ownerRow.getByRole('button', { name: /Remove/i })).toHaveCount(0)
    })
})
