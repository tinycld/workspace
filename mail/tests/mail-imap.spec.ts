import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '../../../../tests/e2e/helpers'
import {
    appendMessage,
    deleteMessage,
    fetchMessageBySubject,
    findPersonalInbox,
    listMailboxes,
    listMessages,
    moveMessage,
    withImapClient,
} from '../../../../tests/e2e/imap-helpers'

test.describe('Mail — IMAP Integration', () => {
    test('lists mailboxes and reads appended messages via IMAP', async () => {
        const subject = `IMAP-roundtrip-${Date.now()}`

        await withImapClient(async client => {
            const mailboxes = await listMailboxes(client)
            const inbox = findPersonalInbox(mailboxes)

            await appendMessage(client, inbox, {
                from: 'sender@example.com',
                to: 'user@tinycld.org',
                subject,
                body: 'Round-trip test message.',
            })

            const messages = await listMessages(client, inbox)
            const subjects = messages.map(m => m.subject)
            expect(subjects).toContain(subject)
        })
    })

    test('IMAP APPEND appears in web UI', async ({ page }) => {
        const subject = `IMAP-test-${Date.now()}`

        await withImapClient(async client => {
            const mailboxes = await listMailboxes(client)
            const inbox = findPersonalInbox(mailboxes)
            await appendMessage(client, inbox, {
                from: 'sender@example.com',
                to: 'user@tinycld.org',
                subject,
                body: 'This message was appended via IMAP.',
            })
        })

        await login(page)
        await navigateToPackage(page, 'mail')
        // Anchor on the row testID + visible filter so we don't match
        // the same subject text in a frozen detail screen mounted by an
        // earlier mail test, and so a virtualized off-screen row still
        // counts as "exists in DOM" via the filter only on attached
        // visible elements.
        await expect(
            page.locator('[data-testid="email-row"]:visible').filter({ hasText: subject }).first()
        ).toBeVisible({ timeout: 10_000 })
    })

    test('MOVE to label folder adds label (Gmail-like)', async () => {
        const subject = `IMAP-label-${Date.now()}`
        const labelName = `test-label-${Date.now()}`

        await withImapClient(async client => {
            const mailboxes = await listMailboxes(client)
            const inbox = findPersonalInbox(mailboxes)

            // Create the label folder and append a test message
            const labelFolder = inbox.replace('/INBOX', `/Labels/${labelName}`)
            const fullLabelPath = labelFolder.includes('/Labels/')
                ? labelFolder
                : `Labels/${labelName}`
            await client.mailboxCreate(fullLabelPath)
            await appendMessage(client, inbox, {
                from: 'labeler@example.com',
                to: 'user@tinycld.org',
                subject,
                body: 'This message will be labeled via MOVE.',
            })

            // Find the message and move it to the label folder
            const msg = await fetchMessageBySubject(client, inbox, subject)
            expect(msg).not.toBeNull()
            await moveMessage(client, inbox, msg?.uid ?? 0, fullLabelPath)

            // Gmail-like: message should still be in INBOX (label is additive)
            const inboxMsgs = await listMessages(client, inbox)
            const stillInInbox = inboxMsgs.some(m => m.subject === subject)
            expect(stillInInbox).toBe(true)

            // And should also appear in the label folder
            const labelMsgs = await listMessages(client, fullLabelPath)
            const inLabel = labelMsgs.some(m => m.subject === subject)
            expect(inLabel).toBe(true)
        })
    })

    test('MOVE to Trash removes from INBOX and shows in Trash', async () => {
        const subject = `IMAP-trash-${Date.now()}`

        await withImapClient(async client => {
            const mailboxes = await listMailboxes(client)
            const inbox = findPersonalInbox(mailboxes)
            const trashFolder = inbox.replace('INBOX', 'Trash')

            await appendMessage(client, inbox, {
                from: 'trasher@example.com',
                to: 'user@tinycld.org',
                subject,
                body: 'This message will be trashed via MOVE.',
            })

            const msg = await fetchMessageBySubject(client, inbox, subject)
            expect(msg).not.toBeNull()
            await moveMessage(client, inbox, msg?.uid ?? 0, trashFolder)

            const inboxMsgs = await listMessages(client, inbox)
            expect(inboxMsgs.some(m => m.subject === subject)).toBe(false)

            const trashMsgs = await listMessages(client, trashFolder)
            expect(trashMsgs.some(m => m.subject === subject)).toBe(true)
        })
    })

    test('LIST advertises RFC 6154 SPECIAL-USE attributes', async () => {
        await withImapClient(async client => {
            const mailboxes = await listMailboxes(client)
            const byBareName = (suffix: string) =>
                mailboxes.find(mb => mb.name === suffix || mb.name.endsWith(`/${suffix}`))

            expect(byBareName('Sent')?.specialUse).toBe('\\Sent')
            expect(byBareName('Drafts')?.specialUse).toBe('\\Drafts')
            expect(byBareName('Trash')?.specialUse).toBe('\\Trash')
            expect(byBareName('Spam')?.specialUse).toBe('\\Junk')
            expect(byBareName('Archive')?.specialUse).toBe('\\Archive')
        })
    })

    test('APPEND to Sent appears in Sent only, not INBOX', async () => {
        const subject = `IMAP-sent-only-${Date.now()}`

        await withImapClient(async client => {
            const mailboxes = await listMailboxes(client)
            const inbox = findPersonalInbox(mailboxes)
            const sent = inbox.replace('INBOX', 'Sent')

            await appendMessage(client, sent, {
                from: 'user@tinycld.org',
                to: 'recipient@example.com',
                subject,
                body: 'A message saved directly to Sent.',
            })

            const sentMsgs = await listMessages(client, sent)
            expect(sentMsgs.filter(m => m.subject === subject).length).toBe(1)

            const inboxMsgs = await listMessages(client, inbox)
            expect(inboxMsgs.some(m => m.subject === subject)).toBe(false)
        })
    })

    test('APPEND deduplicates by Message-ID within a mailbox', async () => {
        const subject = `IMAP-dedup-${Date.now()}`
        const messageId = `<dedup-${Date.now()}@tinycld.test>`

        await withImapClient(async client => {
            const mailboxes = await listMailboxes(client)
            const inbox = findPersonalInbox(mailboxes)
            const sent = inbox.replace('INBOX', 'Sent')

            const opts = {
                from: 'user@tinycld.org',
                to: 'recipient@example.com',
                subject,
                body: 'This message is appended twice with the same Message-ID.',
                messageId,
            }
            await appendMessage(client, sent, opts)
            await appendMessage(client, sent, opts)

            const sentMsgs = await listMessages(client, sent)
            expect(sentMsgs.filter(m => m.subject === subject).length).toBe(1)
        })
    })

    test('IMAP DELETE removes from web UI', async ({ page }) => {
        const subject = `IMAP-delete-${Date.now()}`

        await withImapClient(async client => {
            const mailboxes = await listMailboxes(client)
            const inbox = findPersonalInbox(mailboxes)
            await appendMessage(client, inbox, {
                from: 'sender@example.com',
                to: 'user@tinycld.org',
                subject,
                body: 'This message will be deleted via IMAP.',
            })
        })

        await login(page)
        await navigateToPackage(page, 'mail')
        const row = page
            .locator('[data-testid="email-row"]:visible')
            .filter({ hasText: subject })
            .first()
        await expect(row).toBeVisible({ timeout: 10_000 })

        await withImapClient(async client => {
            const mailboxes = await listMailboxes(client)
            const inbox = findPersonalInbox(mailboxes)
            const msg = await fetchMessageBySubject(client, inbox, subject)
            expect(msg).not.toBeNull()
            await deleteMessage(client, inbox, msg?.uid ?? 0)
        })

        await page.reload()
        await expect(
            page.locator('[data-testid="email-row"]:visible').filter({ hasText: subject })
        ).toHaveCount(0, { timeout: 10_000 })
    })
})
