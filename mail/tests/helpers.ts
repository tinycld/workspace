import type { APIRequestContext, Locator, Page } from '@playwright/test'
import { expect } from '@playwright/test'
import PocketBase from 'pocketbase'
import { ORG_SLUG } from '../../../../tests/e2e/helpers'

// Mail tests share a few patterns that are sensitive to two layout choices
// in the package: (1) screens use FrozenSlideStack so detail/list/folder
// screens stay mounted in the DOM after navigation, and (2) the inbox
// renders rows through a FlashList that virtualizes off-screen items.
// Together those mean a bare `getByText('subject').first()` can match
// either a hidden frozen sibling screen or an off-screen virtualized
// list row, both of which fail toBeVisible(). The helpers below scope
// matches to specific row testIDs and scroll the row into view before
// asserting visibility.

// Locate the inbox row (FlashList <Pressable> wrapping a single thread)
// whose visible text contains `subject`. Returns a Locator chain rather
// than a resolved element so callers can compose `.click()`,
// `.scrollIntoViewIfNeeded()`, etc.
//
// We anchor on `[data-testid="email-row"]:visible` (CSS pseudo-class)
// rather than `getByTestId('email-row')` because FrozenSlideStack keeps
// detail/list/folder screens mounted as the user navigates, so multiple
// list snapshots can carry the same row. Restricting to visible elements
// picks the row that's currently on screen.
export function emailRow(page: Page, subject: string): Locator {
    return page.locator('[data-testid="email-row"]:visible').filter({ hasText: subject }).first()
}

// Wait for the inbox to settle, scroll the named row into view, and assert
// it is visible.
export async function expectRowVisible(page: Page, subject: string) {
    const row = emailRow(page, subject)
    await scrollUntilRowMounts(page, row)
    await row.scrollIntoViewIfNeeded()
    await expect(row).toBeVisible()
}

const SCROLL_STEPS_MAX = 30

async function scrollUntilRowMounts(page: Page, row: Locator) {
    if ((await row.count()) > 0) return

    // FlashList on web wires its ScrollView through to a real scrollable
    // div; the rendered email-row testID lives inside it. Walk up from
    // a *visible* email-row to the nearest scrollable ancestor and
    // increment its scrollTop. Bail if no visible rows exist.
    for (let i = 0; i < SCROLL_STEPS_MAX; i++) {
        const advanced = await page.evaluate(() => {
            const sample = Array.from(document.querySelectorAll('[data-testid="email-row"]')).find(
                node => {
                    const el = node as HTMLElement
                    return el.offsetWidth > 0 && el.offsetHeight > 0
                }
            ) as HTMLElement | undefined
            if (!sample) return false
            let el: HTMLElement | null = sample
            while (el) {
                const style = window.getComputedStyle(el)
                if (
                    el.scrollHeight > el.clientHeight &&
                    (style.overflowY === 'auto' || style.overflowY === 'scroll')
                ) {
                    const before = el.scrollTop
                    el.scrollTop = Math.min(el.scrollHeight, before + el.clientHeight - 60)
                    return el.scrollTop !== before
                }
                el = el.parentElement
            }
            return false
        })
        if (!advanced) return
        await page.waitForTimeout(120)
        if ((await row.count()) > 0) return
    }
}

// Open a thread by clicking the inbox row that matches `subject` and wait
// for the detail screen to mount.
export async function openThread(page: Page, subject: string) {
    const row = emailRow(page, subject)
    await scrollUntilRowMounts(page, row)
    await row.scrollIntoViewIfNeeded()
    await row.click()
    await expect(page.getByTestId('mail-thread-detail')).toBeVisible({ timeout: 10_000 })
}

// Locator scoped to the currently-mounted thread detail container.
export function threadDetail(page: Page): Locator {
    return page.getByTestId('mail-thread-detail')
}

// Navigate to the *personal* mailbox's Inbox folder, bypassing the All
// Inboxes default view. The seed creates a shared "Support" mailbox
// alongside the personal one.
export async function navigateToPersonalInbox(page: Page) {
    await page.getByText('Inbox', { exact: true }).first().click()
    await page.waitForURL(url => /folder=inbox/.test(url.search), { timeout: 5_000 })
    await expect(page.locator('[data-testid="email-row"]:visible').first()).toBeVisible({
        timeout: 10_000,
    })
}

// PB sits behind the dev.ts proxy on the test Expo port. /api/* routes
// through to PB transparently — see scripts/dev.ts::isPbPath.
const PB_URL = 'http://127.0.0.1:7200'
const SUPERUSER_EMAIL = process.env.POCKETBASE_EMAIL || 'admin@tinycld.org'
const SUPERUSER_PASSWORD = process.env.POCKETBASE_PASSWORD || 'AdminPass1234!'

let cachedInboundUrl: string | null = null

async function getInboundWebhookUrl(): Promise<string> {
    if (cachedInboundUrl) return cachedInboundUrl
    const pb = new PocketBase(PB_URL)
    await pb.collection('_superusers').authWithPassword(SUPERUSER_EMAIL, SUPERUSER_PASSWORD)
    const domain = await pb
        .collection('mail_domains')
        .getFirstListItem<{ webhook_secret: string }>('domain = "tinycld.org"')
    if (!domain.webhook_secret) {
        throw new Error('mail_domains.webhook_secret is empty for tinycld.org — seed regression?')
    }
    cachedInboundUrl = `${PB_URL}/api/mail/inbound/${domain.webhook_secret}`
    return cachedInboundUrl
}

export interface DeliverOptions {
    subject: string
    to?: string
    fromName?: string
    fromEmail?: string
    body?: string
    folder?: 'inbox' | 'spam' | 'trash'
}

// Inject a fresh inbound message via the Postmark webhook so the test has
// a row it owns. Returns a unique subject suitable for assertions.
//
// Tests should call `deliverInbound({ subject: \`Test-foo-${stamp}\` })`
// rather than reading seeded subjects — parallel specs that archive,
// trash, or delete seed rows otherwise race the read.
export async function deliverInbound(
    request: APIRequestContext,
    opts: DeliverOptions
): Promise<{ subject: string; messageId: string }> {
    const url = await getInboundWebhookUrl()
    const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const messageId = `${stamp}@tinycld.test`
    const payload = {
        From: opts.fromEmail ?? 'sender@example.com',
        FromName: opts.fromName ?? 'Test Sender',
        FromFull: {
            Name: opts.fromName ?? 'Test Sender',
            Email: opts.fromEmail ?? 'sender@example.com',
        },
        To: opts.to ?? 'user@tinycld.org',
        ToFull: [{ Name: 'Test User', Email: opts.to ?? 'user@tinycld.org' }],
        CcFull: [],
        Subject: opts.subject,
        Date: new Date().toUTCString(),
        TextBody: opts.body ?? 'Test body',
        HtmlBody: `<p>${opts.body ?? 'Test body'}</p>`,
        StrippedTextReply: opts.body ?? 'Test body',
        MessageID: messageId,
        MailboxHash: '',
        Headers: [{ Name: 'Message-ID', Value: `<${messageId}>` }],
        Attachments: [],
    }
    const res = await request.post(url, {
        data: payload,
        headers: { 'Content-Type': 'application/json' },
    })
    if (!res.ok()) {
        const body = await res.text()
        throw new Error(`Inbound delivery failed: ${res.status()} ${body}`)
    }
    return { subject: opts.subject, messageId }
}

// Generate a unique subject prefixed with `label`, suitable for the
// per-test fixture pattern (deliverInbound + assert on this subject).
export function uniqueSubject(label: string): string {
    return `${label} ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export { ORG_SLUG }
