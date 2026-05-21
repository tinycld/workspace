import { readFileSync } from 'node:fs'
import path from 'node:path'
import type PocketBase from 'pocketbase'

function log(...args: unknown[]) {
    process.stdout.write(`[seed:mail] ${args.join(' ')}\n`)
}

// Resolve fixture files relative to the mail package root so the seed can
// attach them to test messages. mail/tinycld/mail/seed.ts → mail/tests/fixtures
const FIXTURES_DIR = path.resolve(import.meta.dirname, '../../tests/fixtures')

function fixtureFile(name: string, type: string): File {
    const bytes = readFileSync(path.join(FIXTURES_DIR, name))
    return new File([new Uint8Array(bytes)], name, { type })
}

const MIME_BY_EXT: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    pdf: 'application/pdf',
}

function mimeFromName(name: string): string {
    const ext = name.split('.').pop()?.toLowerCase() ?? ''
    return MIME_BY_EXT[ext] ?? 'application/octet-stream'
}

interface SeedContext {
    user: { id: string; email: string; name: string }
    org: { id: string }
    userOrg: { id: string }
}

interface SeedMessage {
    sender_name: string
    sender_email: string
    recipients_to: { name: string; email: string }[]
    date: string
    subject: string
    snippet: string
    body_html: string
    in_reply_to?: string
    /** Filenames in mail/tests/fixtures/ to attach to the message. */
    attachments?: string[]
}

function htmlBlob(html: string) {
    return new File([html], 'body.html', { type: 'text/html' })
}

const LABELS = [
    { name: 'Work', color: '#3949ab' },
    { name: 'Personal', color: '#43a047' },
    { name: 'Finance', color: '#f4511e' },
    { name: 'Travel', color: '#e53935' },
    { name: 'Urgent', color: '#d81b60' },
    { name: 'Clients', color: '#00acc1' },
    { name: 'Newsletters', color: '#8e24aa' },
    { name: 'Receipts', color: '#00897b' },
] as const

const THREADS: {
    subject: string
    snippet: string
    message_count: number
    latest_date: string
    participants: { name: string; email: string }[]
    folder: 'inbox' | 'sent' | 'drafts' | 'trash' | 'spam' | 'archive'
    is_read: boolean
    is_starred: boolean
    labels: string[]
    messages: SeedMessage[]
}[] = [
    {
        subject: 'Q2 Product Roadmap Review',
        snippet:
            "Hi team, I've attached the updated Q2 roadmap with the changes we discussed in yesterday's meeting. Please review and add any comments before Friday.",
        message_count: 3,
        latest_date: '2026-04-04 10:42:00.000Z',
        participants: [
            { name: 'Alice Chen', email: 'alice.chen@tinycld.org' },
            { name: 'Bob Park', email: 'bob.park@tinycld.org' },
        ],
        folder: 'inbox',
        is_read: false,
        is_starred: true,
        labels: ['Work', 'Urgent'],
        messages: [
            {
                sender_name: 'Alice Chen',
                sender_email: 'alice.chen@tinycld.org',
                recipients_to: [{ name: 'Team', email: 'support@tinycld.org' }],
                date: '2026-04-04 08:00:00.000Z',
                subject: 'Q2 Product Roadmap Review',
                snippet: 'Hi team, here is the initial Q2 roadmap draft for review.',
                body_html:
                    '<p>Hi team,</p><p>Here is the initial Q2 roadmap draft for review. Please take a look and share your thoughts.</p><p>Best,<br/>Alice</p>',
            },
            {
                sender_name: 'Bob Park',
                sender_email: 'bob.park@tinycld.org',
                recipients_to: [{ name: 'Team', email: 'support@tinycld.org' }],
                in_reply_to: 'roadmap-1@tinycld.org',
                date: '2026-04-04 09:30:00.000Z',
                subject: 'Re: Q2 Product Roadmap Review',
                snippet: 'Looks good overall. I have a few suggestions on the Sprint 14 timeline.',
                body_html:
                    '<p>Looks good overall. I have a few suggestions on the Sprint 14 timeline.</p><p>Can we move the billing migration earlier? The team is ready now.</p><p>Bob</p>',
            },
            {
                sender_name: 'Alice Chen',
                sender_email: 'alice.chen@tinycld.org',
                recipients_to: [{ name: 'Team', email: 'support@tinycld.org' }],
                in_reply_to: 'roadmap-2@tinycld.org',
                date: '2026-04-04 10:42:00.000Z',
                subject: 'Re: Q2 Product Roadmap Review',
                snippet: "I've attached the updated Q2 roadmap with the changes we discussed in yesterday's meeting.",
                body_html:
                    "<p>Hi team,</p><p>I've attached the updated Q2 roadmap with the changes we discussed in yesterday's meeting. Please review and add any comments before Friday.</p><p>Key changes include:</p><ul><li>Moved the billing migration to Sprint 14</li><li>Added the new onboarding flow to Sprint 12</li><li>Deprioritized the analytics dashboard redesign</li></ul><p>Let me know if you have questions.</p><p>Best,<br/>Alice</p>",
            },
        ],
    },
    {
        subject: '[tinycld/app] Fix: resolve subdomain redirect loop (#247)',
        snippet:
            'nathanstitt merged pull request #247 into main. The redirect loop when navigating between org subdomains has been resolved.',
        message_count: 1,
        latest_date: '2026-04-04 09:15:00.000Z',
        participants: [{ name: 'GitHub', email: 'notifications@github.com' }],
        folder: 'inbox',
        is_read: true,
        is_starred: false,
        labels: ['Newsletters'],
        messages: [
            {
                sender_name: 'GitHub',
                sender_email: 'notifications@github.com',
                recipients_to: [{ name: 'Alice', email: 'alice@tinycld.org' }],
                date: '2026-04-04 09:15:00.000Z',
                subject: '[tinycld/app] Fix: resolve subdomain redirect loop (#247)',
                snippet: 'nathanstitt merged pull request #247 into main.',
                body_html:
                    '<p><strong>nathanstitt</strong> merged pull request <a href="#">#247</a> into <code>main</code>.</p><p>The redirect loop when navigating between org subdomains has been resolved by checking the current hostname before triggering a redirect.</p><p>Files changed: 3<br/>Additions: 42<br/>Deletions: 18</p>',
            },
        ],
    },
    {
        subject: 'Lunch tomorrow?',
        snippet: "Hey! Are you free for lunch tomorrow around noon? There's a new Thai place on 5th that just opened.",
        message_count: 1,
        latest_date: '2026-04-03 12:30:00.000Z',
        participants: [{ name: 'Marcus Johnson', email: 'marcus.j@tinycld.org' }],
        folder: 'inbox',
        is_read: true,
        is_starred: false,
        labels: ['Personal'],
        messages: [
            {
                sender_name: 'Marcus Johnson',
                sender_email: 'marcus.j@tinycld.org',
                recipients_to: [{ name: 'Alice', email: 'alice@tinycld.org' }],
                date: '2026-04-03 12:30:00.000Z',
                subject: 'Lunch tomorrow?',
                snippet: 'Hey! Are you free for lunch tomorrow around noon?',
                body_html:
                    "<p>Hey!</p><p>Are you free for lunch tomorrow around noon? There's a new Thai place on 5th that just opened. Heard great things about their pad see ew.</p><p>Let me know!</p><p>Marcus</p>",
            },
        ],
    },
    {
        subject: 'Your receipt from TinyCld',
        snippet: 'Payment of $49.00 for TinyCld Pro Plan (Monthly) was successfully processed on April 1, 2026.',
        message_count: 1,
        latest_date: '2026-04-01 14:00:00.000Z',
        participants: [{ name: 'Stripe', email: 'receipts@stripe.com' }],
        folder: 'inbox',
        is_read: true,
        is_starred: false,
        labels: ['Finance', 'Receipts'],
        messages: [
            {
                sender_name: 'Stripe',
                sender_email: 'receipts@stripe.com',
                recipients_to: [{ name: 'Alice', email: 'alice@tinycld.org' }],
                date: '2026-04-01 14:00:00.000Z',
                subject: 'Your receipt from TinyCld',
                snippet: 'Payment of $49.00 for TinyCld Pro Plan (Monthly) was successfully processed.',
                body_html:
                    '<p>Payment of <strong>$49.00</strong> for TinyCld Pro Plan (Monthly) was successfully processed on April 1, 2026.</p><p>Invoice #INV-2026-0401</p><p>If you have any questions about this charge, please contact support.</p>',
            },
        ],
    },
    {
        subject: 'Re: Conference travel arrangements',
        snippet: "I've booked the flights for the team. Departing SFO on the 15th at 8:30 AM, returning on the 18th.",
        message_count: 5,
        latest_date: '2026-03-30 16:45:00.000Z',
        participants: [
            { name: 'Sarah Kim', email: 'sarah.kim@tinycld.org' },
            { name: 'Alice', email: 'alice@tinycld.org' },
            { name: 'David Lee', email: 'david.lee@tinycld.org' },
        ],
        folder: 'inbox',
        is_read: false,
        is_starred: true,
        labels: ['Work', 'Travel', 'Clients'],
        messages: [
            {
                sender_name: 'David Lee',
                sender_email: 'david.lee@tinycld.org',
                recipients_to: [
                    { name: 'Sarah Kim', email: 'sarah.kim@tinycld.org' },
                    { name: 'Alice', email: 'alice@tinycld.org' },
                ],
                date: '2026-03-28 09:00:00.000Z',
                subject: 'Conference travel arrangements',
                snippet: 'Hi all, we need to book travel for the NYC conference.',
                body_html:
                    '<p>Hi all,</p><p>We need to book travel for the NYC conference April 15-18. Can someone take the lead on flights and hotel?</p><p>David</p>',
            },
            {
                sender_name: 'Alice',
                sender_email: 'alice@tinycld.org',
                recipients_to: [
                    { name: 'Sarah Kim', email: 'sarah.kim@tinycld.org' },
                    { name: 'David Lee', email: 'david.lee@tinycld.org' },
                ],
                in_reply_to: 'travel-1@tinycld.org',
                date: '2026-03-28 10:15:00.000Z',
                subject: 'Re: Conference travel arrangements',
                snippet: 'I can help coordinate. Sarah, can you handle flights?',
                body_html:
                    "<p>I can help coordinate. Sarah, can you handle flights? I'll look into hotels.</p><p>Alice</p>",
            },
            {
                sender_name: 'Sarah Kim',
                sender_email: 'sarah.kim@tinycld.org',
                recipients_to: [
                    { name: 'Alice', email: 'alice@tinycld.org' },
                    { name: 'David Lee', email: 'david.lee@tinycld.org' },
                ],
                in_reply_to: 'travel-2@tinycld.org',
                date: '2026-03-29 11:00:00.000Z',
                subject: 'Re: Conference travel arrangements',
                snippet: 'On it! Looking at flights now.',
                body_html: '<p>On it! Looking at flights now. Will share options by end of day.</p><p>Sarah</p>',
            },
            {
                sender_name: 'Alice',
                sender_email: 'alice@tinycld.org',
                recipients_to: [
                    { name: 'Sarah Kim', email: 'sarah.kim@tinycld.org' },
                    { name: 'David Lee', email: 'david.lee@tinycld.org' },
                ],
                in_reply_to: 'travel-3@tinycld.org',
                date: '2026-03-30 08:30:00.000Z',
                subject: 'Re: Conference travel arrangements',
                snippet: "I've booked the Marriott Marquis. Confirmation numbers coming separately.",
                body_html:
                    "<p>I've booked the Marriott Marquis in Times Square for all three of us. Confirmation numbers coming separately.</p><p>Alice</p>",
            },
            {
                sender_name: 'Sarah Kim',
                sender_email: 'sarah.kim@tinycld.org',
                recipients_to: [
                    { name: 'Alice', email: 'alice@tinycld.org' },
                    { name: 'David Lee', email: 'david.lee@tinycld.org' },
                ],
                in_reply_to: 'travel-4@tinycld.org',
                date: '2026-03-30 16:45:00.000Z',
                subject: 'Re: Conference travel arrangements',
                snippet: "I've booked the flights for the team. Departing SFO on the 15th at 8:30 AM.",
                body_html:
                    "<p>I've booked the flights for the team. Here are the details:</p><p><strong>Departure:</strong> SFO → JFK, April 15, 8:30 AM<br/><strong>Return:</strong> JFK → SFO, April 18, 6:15 PM</p><p>Hotel reservations are at the Marriott Marquis in Times Square. I'll send the confirmation numbers separately.</p><p>Sarah</p>",
            },
        ],
    },
    {
        subject: 'Draft: Monthly newsletter',
        snippet: "Here's the draft for this month's newsletter. Still need to add the section about new features.",
        message_count: 1,
        latest_date: '2026-03-28 15:00:00.000Z',
        participants: [{ name: 'Alice', email: 'alice@tinycld.org' }],
        folder: 'drafts',
        is_read: true,
        is_starred: false,
        labels: [],
        messages: [
            {
                sender_name: 'Alice',
                sender_email: 'alice@tinycld.org',
                recipients_to: [],
                date: '2026-03-28 15:00:00.000Z',
                subject: 'Draft: Monthly newsletter',
                snippet: "Here's the draft for this month's newsletter.",
                body_html:
                    "<p>Here's the draft for this month's newsletter. Still need to add the section about new features and the customer spotlight.</p><p>TODO:</p><ul><li>Add new features section</li><li>Customer spotlight: Acme Corp</li><li>Proofread and finalize</li></ul>",
            },
        ],
    },
    {
        subject: 'Team standup notes — March 27',
        snippet: "Quick summary from today's standup: API migration on track, mobile app release pushed to next week.",
        message_count: 1,
        latest_date: '2026-03-27 17:00:00.000Z',
        participants: [{ name: 'Alice', email: 'alice@tinycld.org' }],
        folder: 'sent',
        is_read: true,
        is_starred: false,
        labels: ['Work'],
        messages: [
            {
                sender_name: 'Alice',
                sender_email: 'alice@tinycld.org',
                recipients_to: [{ name: 'Team', email: 'support@tinycld.org' }],
                date: '2026-03-27 17:00:00.000Z',
                subject: 'Team standup notes — March 27',
                snippet: "Quick summary from today's standup.",
                body_html:
                    "<p>Quick summary from today's standup:</p><ul><li>API migration on track for Friday deploy</li><li>Mobile app release pushed to next week due to App Store review delays</li><li>New hire starting Monday — onboarding buddy: Marcus</li></ul>",
            },
        ],
    },
    // --- Additional threads below to fill out the inbox ---
    {
        subject: 'Weekly engineering sync — April 7',
        snippet: 'Agenda for this week: deploy retrospective, Q2 OKR check-in, and new hire intros.',
        message_count: 2,
        latest_date: '2026-04-07 11:00:00.000Z',
        participants: [
            { name: 'Marcus Johnson', email: 'marcus.j@tinycld.org' },
            { name: 'Alice', email: 'alice@tinycld.org' },
        ],
        folder: 'inbox',
        is_read: false,
        is_starred: false,
        labels: ['Work'],
        messages: [
            {
                sender_name: 'Marcus Johnson',
                sender_email: 'marcus.j@tinycld.org',
                recipients_to: [{ name: 'Engineering', email: 'support@tinycld.org' }],
                date: '2026-04-07 09:00:00.000Z',
                subject: 'Weekly engineering sync — April 7',
                snippet: 'Hey team, here is the agenda for this week.',
                body_html:
                    '<p>Hey team,</p><p>Agenda for this week:</p><ol><li>Deploy retrospective from Friday</li><li>Q2 OKR check-in</li><li>New hire intros — welcome Priya and Jorge!</li></ol><p>See you at 11.</p><p>Marcus</p>',
            },
            {
                sender_name: 'Alice',
                sender_email: 'alice@tinycld.org',
                recipients_to: [{ name: 'Engineering', email: 'support@tinycld.org' }],
                in_reply_to: 'eng-sync-1@tinycld.org',
                date: '2026-04-07 11:00:00.000Z',
                subject: 'Re: Weekly engineering sync — April 7',
                snippet: 'Can we also add a quick discussion about the CI pipeline flakiness?',
                body_html:
                    '<p>Can we also add a quick discussion about the CI pipeline flakiness? We had 3 false failures last week.</p><p>Alice</p>',
            },
        ],
    },
    {
        subject: 'Your AWS bill for March 2026',
        snippet: 'Your total charges for March 2026: $312.47. View your detailed billing statement.',
        message_count: 1,
        latest_date: '2026-04-02 06:00:00.000Z',
        participants: [{ name: 'AWS Billing', email: 'billing@aws.amazon.com' }],
        folder: 'inbox',
        is_read: true,
        is_starred: false,
        labels: ['Finance', 'Receipts'],
        messages: [
            {
                sender_name: 'AWS Billing',
                sender_email: 'billing@aws.amazon.com',
                recipients_to: [{ name: 'Alice', email: 'alice@tinycld.org' }],
                date: '2026-04-02 06:00:00.000Z',
                subject: 'Your AWS bill for March 2026',
                snippet: 'Your total charges for March 2026: $312.47.',
                body_html:
                    '<p>Your total AWS charges for <strong>March 2026</strong>: <strong>$312.47</strong></p><p>Service breakdown:</p><ul><li>EC2: $142.30</li><li>RDS: $89.50</li><li>S3: $34.67</li><li>CloudFront: $28.00</li><li>Other: $18.00</li></ul><p>View your detailed billing statement in the AWS Console.</p>',
            },
        ],
    },
    {
        subject: 'Design review: new onboarding flow',
        snippet: "Hi Alice, I've finished the mockups for the new onboarding flow. Can you take a look?",
        message_count: 4,
        latest_date: '2026-04-06 15:30:00.000Z',
        participants: [
            { name: 'Rachel Moore', email: 'rachel.moore@tinycld.org' },
            { name: 'Alice', email: 'alice@tinycld.org' },
            { name: 'Bob Park', email: 'bob.park@tinycld.org' },
        ],
        folder: 'inbox',
        is_read: false,
        is_starred: true,
        labels: ['Work'],
        messages: [
            {
                sender_name: 'Rachel Moore',
                sender_email: 'rachel.moore@tinycld.org',
                recipients_to: [
                    { name: 'Alice', email: 'alice@tinycld.org' },
                    { name: 'Bob Park', email: 'bob.park@tinycld.org' },
                ],
                date: '2026-04-05 10:00:00.000Z',
                subject: 'Design review: new onboarding flow',
                snippet: "I've finished the mockups for the new onboarding flow.",
                body_html:
                    "<p>Hi Alice and Bob,</p><p>I've finished the mockups for the new onboarding flow. The Figma link is in the project channel.</p><p>Key changes from the last iteration:</p><ul><li>Simplified step 1 — removed the company size question</li><li>Added a progress indicator at the top</li><li>New illustration style for the welcome screen</li></ul><p>Let me know your thoughts!</p><p>Rachel</p>",
            },
            {
                sender_name: 'Alice',
                sender_email: 'alice@tinycld.org',
                recipients_to: [
                    { name: 'Rachel Moore', email: 'rachel.moore@tinycld.org' },
                    { name: 'Bob Park', email: 'bob.park@tinycld.org' },
                ],
                in_reply_to: 'onboarding-1@tinycld.org',
                date: '2026-04-05 14:20:00.000Z',
                subject: 'Re: Design review: new onboarding flow',
                snippet: 'These look great! I love the simplified first step.',
                body_html:
                    '<p>These look great! I love the simplified first step. One thought — can we add a skip option for users who are being invited to an existing org?</p><p>Alice</p>',
            },
            {
                sender_name: 'Bob Park',
                sender_email: 'bob.park@tinycld.org',
                recipients_to: [
                    { name: 'Rachel Moore', email: 'rachel.moore@tinycld.org' },
                    { name: 'Alice', email: 'alice@tinycld.org' },
                ],
                in_reply_to: 'onboarding-2@tinycld.org',
                date: '2026-04-06 09:00:00.000Z',
                subject: 'Re: Design review: new onboarding flow',
                snippet: 'Agreed on the skip option. Also, the progress bar looks off on mobile.',
                body_html:
                    '<p>Agreed on the skip option. Also, the progress bar looks a bit off on mobile — might need a different layout for smaller screens.</p><p>Otherwise LGTM.</p><p>Bob</p>',
            },
            {
                sender_name: 'Rachel Moore',
                sender_email: 'rachel.moore@tinycld.org',
                recipients_to: [
                    { name: 'Alice', email: 'alice@tinycld.org' },
                    { name: 'Bob Park', email: 'bob.park@tinycld.org' },
                ],
                in_reply_to: 'onboarding-3@tinycld.org',
                date: '2026-04-06 15:30:00.000Z',
                subject: 'Re: Design review: new onboarding flow',
                snippet: 'Updated both — skip option and mobile progress bar fix are in the latest Figma.',
                body_html:
                    '<p>Updated both — skip option and mobile progress bar fix are in the latest Figma revision. Take another look when you get a chance.</p><p>Rachel</p>',
            },
        ],
    },
    {
        subject: 'Invitation: Team offsite planning',
        snippet: "You're invited to collaborate on the Q2 team offsite. Date: May 2-3 at the coast house.",
        message_count: 1,
        latest_date: '2026-04-06 08:00:00.000Z',
        participants: [{ name: 'David Lee', email: 'david.lee@tinycld.org' }],
        folder: 'inbox',
        is_read: true,
        is_starred: true,
        labels: ['Work', 'Travel'],
        messages: [
            {
                sender_name: 'David Lee',
                sender_email: 'david.lee@tinycld.org',
                recipients_to: [{ name: 'Team', email: 'support@tinycld.org' }],
                date: '2026-04-06 08:00:00.000Z',
                subject: 'Invitation: Team offsite planning',
                snippet: "You're invited to the Q2 team offsite. May 2-3 at the coast house.",
                body_html:
                    "<p>Hey team,</p><p>We're doing a Q2 offsite May 2-3 at the coast house in Half Moon Bay. Agenda:</p><ul><li>Product vision for H2</li><li>Team-building activities</li><li>Hackathon afternoon on day 2</li></ul><p>Please RSVP by April 15. Carpools will be arranged.</p><p>David</p>",
            },
        ],
    },
    {
        subject: '[tinycld/app] CI: build failed on main (#251)',
        snippet: 'Build #251 failed. 2 test suites with failures. Click to view the logs.',
        message_count: 1,
        latest_date: '2026-04-07 02:30:00.000Z',
        participants: [{ name: 'GitHub Actions', email: 'notifications@github.com' }],
        folder: 'inbox',
        is_read: false,
        is_starred: false,
        labels: ['Work'],
        messages: [
            {
                sender_name: 'GitHub Actions',
                sender_email: 'notifications@github.com',
                recipients_to: [{ name: 'Alice', email: 'alice@tinycld.org' }],
                date: '2026-04-07 02:30:00.000Z',
                subject: '[tinycld/app] CI: build failed on main (#251)',
                snippet: 'Build #251 failed. 2 test suites with failures.',
                body_html:
                    '<p><strong>Build #251 failed</strong> on <code>main</code></p><p>2 test suites with failures:</p><ul><li><code>auth.spec.ts</code> — timeout in login flow</li><li><code>drive-upload.spec.ts</code> — file size assertion</li></ul><p>Triggered by commit <code>a3f8e21</code> by @bob.park</p>',
            },
        ],
    },
    {
        subject: 'Your Figma invoice — April 2026',
        snippet: 'Your Figma Organization plan invoice for April 2026: $75.00.',
        message_count: 1,
        latest_date: '2026-04-01 07:00:00.000Z',
        participants: [{ name: 'Figma', email: 'billing@figma.com' }],
        folder: 'inbox',
        is_read: true,
        is_starred: false,
        labels: ['Finance', 'Receipts'],
        messages: [
            {
                sender_name: 'Figma',
                sender_email: 'billing@figma.com',
                recipients_to: [{ name: 'Alice', email: 'alice@tinycld.org' }],
                date: '2026-04-01 07:00:00.000Z',
                subject: 'Your Figma invoice — April 2026',
                snippet: 'Figma Organization plan — April 2026: $75.00.',
                body_html:
                    '<p>Your Figma Organization plan invoice for <strong>April 2026</strong>:</p><p><strong>$75.00</strong> — 5 editor seats</p><p>Payment method: Visa ending in 4242</p><p>View your invoice in the Figma admin console.</p>',
            },
        ],
    },
    {
        subject: 'Coffee chat next week?',
        snippet: 'Hey! I just joined the team and would love to grab a coffee and learn about the product.',
        message_count: 2,
        latest_date: '2026-04-05 16:00:00.000Z',
        participants: [
            { name: 'Priya Sharma', email: 'priya.sharma@tinycld.org' },
            { name: 'Alice', email: 'alice@tinycld.org' },
        ],
        folder: 'inbox',
        is_read: true,
        is_starred: false,
        labels: ['Personal'],
        messages: [
            {
                sender_name: 'Priya Sharma',
                sender_email: 'priya.sharma@tinycld.org',
                recipients_to: [{ name: 'Alice', email: 'alice@tinycld.org' }],
                date: '2026-04-05 11:00:00.000Z',
                subject: 'Coffee chat next week?',
                snippet: 'Hey! I just joined the team and would love to grab a coffee.',
                body_html:
                    '<p>Hey Alice!</p><p>I just joined the team this week and would love to grab a coffee and learn more about the product roadmap. Are you free Tuesday or Wednesday afternoon?</p><p>Looking forward to meeting you!</p><p>Priya</p>',
            },
            {
                sender_name: 'Alice',
                sender_email: 'alice@tinycld.org',
                recipients_to: [{ name: 'Priya Sharma', email: 'priya.sharma@tinycld.org' }],
                in_reply_to: 'coffee-1@tinycld.org',
                date: '2026-04-05 16:00:00.000Z',
                subject: 'Re: Coffee chat next week?',
                snippet: 'Welcome to the team! Wednesday at 2 works great for me.',
                body_html:
                    '<p>Welcome to the team, Priya! Wednesday at 2 PM works great for me. Meet at the Blue Bottle on Market St?</p><p>Alice</p>',
            },
        ],
    },
    {
        subject: 'Security alert: new sign-in from Chrome on macOS',
        snippet: 'We noticed a new sign-in to your account from Chrome on macOS in San Francisco, CA.',
        message_count: 1,
        latest_date: '2026-04-03 22:15:00.000Z',
        participants: [{ name: 'TinyCld Security', email: 'security@tinycld.org' }],
        folder: 'inbox',
        is_read: true,
        is_starred: false,
        labels: [],
        messages: [
            {
                sender_name: 'TinyCld Security',
                sender_email: 'security@tinycld.org',
                recipients_to: [{ name: 'Alice', email: 'alice@tinycld.org' }],
                date: '2026-04-03 22:15:00.000Z',
                subject: 'Security alert: new sign-in from Chrome on macOS',
                snippet: 'New sign-in from Chrome on macOS in San Francisco, CA.',
                body_html:
                    "<p>We noticed a new sign-in to your account.</p><p><strong>Device:</strong> Chrome on macOS<br/><strong>Location:</strong> San Francisco, CA<br/><strong>Time:</strong> April 3, 2026, 10:15 PM</p><p>If this was you, no action is needed. If you didn't sign in, please reset your password immediately.</p>",
            },
        ],
    },
    {
        subject: 'Re: API rate limiting strategy',
        snippet: "I think we should go with token bucket. Here's a comparison of the three approaches.",
        message_count: 3,
        latest_date: '2026-04-03 17:20:00.000Z',
        participants: [
            { name: 'Bob Park', email: 'bob.park@tinycld.org' },
            { name: 'Alice', email: 'alice@tinycld.org' },
            { name: 'Jorge Mendez', email: 'jorge.mendez@tinycld.org' },
        ],
        folder: 'inbox',
        is_read: true,
        is_starred: false,
        labels: ['Work'],
        messages: [
            {
                sender_name: 'Bob Park',
                sender_email: 'bob.park@tinycld.org',
                recipients_to: [
                    { name: 'Alice', email: 'alice@tinycld.org' },
                    { name: 'Jorge Mendez', email: 'jorge.mendez@tinycld.org' },
                ],
                date: '2026-04-03 10:00:00.000Z',
                subject: 'API rate limiting strategy',
                snippet: 'We need to decide on a rate limiting approach before the API goes public.',
                body_html:
                    '<p>Hey Alice and Jorge,</p><p>We need to decide on a rate limiting approach before the public API launch. Three options:</p><ol><li>Fixed window</li><li>Sliding window</li><li>Token bucket</li></ol><p>Thoughts?</p><p>Bob</p>',
            },
            {
                sender_name: 'Jorge Mendez',
                sender_email: 'jorge.mendez@tinycld.org',
                recipients_to: [
                    { name: 'Bob Park', email: 'bob.park@tinycld.org' },
                    { name: 'Alice', email: 'alice@tinycld.org' },
                ],
                in_reply_to: 'ratelimit-1@tinycld.org',
                date: '2026-04-03 14:30:00.000Z',
                subject: 'Re: API rate limiting strategy',
                snippet: 'Token bucket gives us the most flexibility for burst traffic.',
                body_html:
                    '<p>Token bucket gives us the most flexibility for burst traffic. I used it at my last company and it scaled well.</p><p>I can put together a proof of concept by Thursday.</p><p>Jorge</p>',
            },
            {
                sender_name: 'Alice',
                sender_email: 'alice@tinycld.org',
                recipients_to: [
                    { name: 'Bob Park', email: 'bob.park@tinycld.org' },
                    { name: 'Jorge Mendez', email: 'jorge.mendez@tinycld.org' },
                ],
                in_reply_to: 'ratelimit-2@tinycld.org',
                date: '2026-04-03 17:20:00.000Z',
                subject: 'Re: API rate limiting strategy',
                snippet: 'Agreed on token bucket. Jorge, that would be great.',
                body_html:
                    "<p>Agreed on token bucket. Jorge, a PoC by Thursday would be perfect — we can review it in Friday's sync.</p><p>Alice</p>",
            },
        ],
    },
    {
        subject: 'Vercel deployment successful: tinycld-web',
        snippet: 'Production deployment completed. Preview: https://tinycld-web.vercel.app',
        message_count: 1,
        latest_date: '2026-04-06 19:45:00.000Z',
        participants: [{ name: 'Vercel', email: 'notifications@vercel.com' }],
        folder: 'inbox',
        is_read: true,
        is_starred: false,
        labels: ['Newsletters'],
        messages: [
            {
                sender_name: 'Vercel',
                sender_email: 'notifications@vercel.com',
                recipients_to: [{ name: 'Alice', email: 'alice@tinycld.org' }],
                date: '2026-04-06 19:45:00.000Z',
                subject: 'Vercel deployment successful: tinycld-web',
                snippet: 'Production deployment completed successfully.',
                body_html:
                    '<p><strong>Deployment successful</strong></p><p>Project: tinycld-web<br/>Branch: main<br/>Commit: <code>e7b2c4d</code> — "fix: mobile nav drawer z-index"</p><p>Build time: 47s<br/>Status: ✓ Ready</p>',
            },
        ],
    },
    {
        subject: 'Can you review my PR? (#253)',
        snippet: 'Hey Alice, I submitted a PR for the contact import feature. Would appreciate your review.',
        message_count: 1,
        latest_date: '2026-04-07 14:00:00.000Z',
        participants: [{ name: 'Sarah Kim', email: 'sarah.kim@tinycld.org' }],
        folder: 'inbox',
        is_read: false,
        is_starred: false,
        labels: ['Work'],
        messages: [
            {
                sender_name: 'Sarah Kim',
                sender_email: 'sarah.kim@tinycld.org',
                recipients_to: [{ name: 'Alice', email: 'alice@tinycld.org' }],
                date: '2026-04-07 14:00:00.000Z',
                subject: 'Can you review my PR? (#253)',
                snippet: 'I submitted a PR for the contact import feature.',
                body_html:
                    "<p>Hey Alice,</p><p>I submitted PR #253 for the contact import feature. It adds CSV and vCard import with validation and duplicate detection.</p><p>It's about 400 lines — should be a quick review. Let me know if you have questions.</p><p>Sarah</p>",
            },
        ],
    },
    {
        subject: 'Your weekly digest — TinyCld Community',
        snippet: 'This week: 12 new discussions, 3 resolved issues, and a new integration guide.',
        message_count: 1,
        latest_date: '2026-04-07 08:00:00.000Z',
        participants: [{ name: 'TinyCld Community', email: 'digest@community.tinycld.org' }],
        folder: 'inbox',
        is_read: true,
        is_starred: false,
        labels: ['Newsletters'],
        messages: [
            {
                sender_name: 'TinyCld Community',
                sender_email: 'digest@community.tinycld.org',
                recipients_to: [{ name: 'Alice', email: 'alice@tinycld.org' }],
                date: '2026-04-07 08:00:00.000Z',
                subject: 'Your weekly digest — TinyCld Community',
                snippet: 'This week: 12 new discussions, 3 resolved issues.',
                body_html:
                    '<p><strong>Your weekly digest</strong></p><p>This week in the TinyCld Community:</p><ul><li>12 new discussions</li><li>3 resolved issues</li><li>New guide: "Integrating with Zapier"</li><li>Most discussed: "Best practices for multi-org setups"</li></ul>',
            },
        ],
    },
    {
        subject: 'Expense report — March 2026',
        snippet: 'Please review and approve the attached expense report for March. Total: $847.32.',
        message_count: 2,
        latest_date: '2026-04-02 11:30:00.000Z',
        participants: [
            { name: 'David Lee', email: 'david.lee@tinycld.org' },
            { name: 'Alice', email: 'alice@tinycld.org' },
        ],
        folder: 'inbox',
        is_read: true,
        is_starred: false,
        labels: ['Finance'],
        messages: [
            {
                sender_name: 'David Lee',
                sender_email: 'david.lee@tinycld.org',
                recipients_to: [{ name: 'Alice', email: 'alice@tinycld.org' }],
                date: '2026-04-01 16:00:00.000Z',
                subject: 'Expense report — March 2026',
                snippet: 'Please review and approve the attached expense report.',
                body_html:
                    '<p>Hi Alice,</p><p>Please review and approve my expense report for March:</p><ul><li>Client dinner (3/12): $234.50</li><li>Uber rides (5 trips): $87.32</li><li>Conference tickets: $450.00</li><li>Office supplies: $75.50</li></ul><p><strong>Total: $847.32</strong></p><p>David</p>',
            },
            {
                sender_name: 'Alice',
                sender_email: 'alice@tinycld.org',
                recipients_to: [{ name: 'David Lee', email: 'david.lee@tinycld.org' }],
                in_reply_to: 'expense-1@tinycld.org',
                date: '2026-04-02 11:30:00.000Z',
                subject: 'Re: Expense report — March 2026',
                snippet: 'Approved! Forwarded to finance.',
                body_html:
                    "<p>Approved! I've forwarded it to finance. You should see the reimbursement within 5 business days.</p><p>Alice</p>",
            },
        ],
    },
    {
        subject: 'Happy birthday, Alice!',
        snippet: 'Wishing you an amazing birthday! Hope you have a great day.',
        message_count: 1,
        latest_date: '2026-03-15 00:01:00.000Z',
        participants: [{ name: 'Marcus Johnson', email: 'marcus.j@tinycld.org' }],
        folder: 'inbox',
        is_read: true,
        is_starred: true,
        labels: ['Personal'],
        messages: [
            {
                sender_name: 'Marcus Johnson',
                sender_email: 'marcus.j@tinycld.org',
                recipients_to: [{ name: 'Alice', email: 'alice@tinycld.org' }],
                date: '2026-03-15 00:01:00.000Z',
                subject: 'Happy birthday, Alice!',
                snippet: 'Wishing you an amazing birthday!',
                body_html:
                    "<p>Happy birthday, Alice! 🎂</p><p>Wishing you an amazing day. Let's celebrate this weekend — dinner on me!</p><p>Marcus</p>",
            },
        ],
    },
    {
        subject: 'Re: Database migration plan',
        snippet: 'I ran the migration in staging — all good. Ready to schedule production.',
        message_count: 4,
        latest_date: '2026-04-04 16:00:00.000Z',
        participants: [
            { name: 'Bob Park', email: 'bob.park@tinycld.org' },
            { name: 'Alice', email: 'alice@tinycld.org' },
        ],
        folder: 'inbox',
        is_read: true,
        is_starred: false,
        labels: ['Work', 'Urgent'],
        messages: [
            {
                sender_name: 'Bob Park',
                sender_email: 'bob.park@tinycld.org',
                recipients_to: [{ name: 'Alice', email: 'alice@tinycld.org' }],
                date: '2026-04-03 09:00:00.000Z',
                subject: 'Database migration plan',
                snippet: "Here's the migration plan for the contacts schema update.",
                body_html:
                    "<p>Alice,</p><p>Here's the migration plan for the contacts schema update:</p><ol><li>Add new columns (non-breaking)</li><li>Backfill existing records</li><li>Deploy new API version</li><li>Drop deprecated columns (next release)</li></ol><p>Estimated downtime: 0. All additive changes.</p><p>Bob</p>",
            },
            {
                sender_name: 'Alice',
                sender_email: 'alice@tinycld.org',
                recipients_to: [{ name: 'Bob Park', email: 'bob.park@tinycld.org' }],
                in_reply_to: 'dbmigration-1@tinycld.org',
                date: '2026-04-03 11:00:00.000Z',
                subject: 'Re: Database migration plan',
                snippet: 'Looks solid. Can we run it in staging first?',
                body_html:
                    '<p>Looks solid. Can we run it in staging first and monitor for 24 hours before prod?</p><p>Alice</p>',
            },
            {
                sender_name: 'Bob Park',
                sender_email: 'bob.park@tinycld.org',
                recipients_to: [{ name: 'Alice', email: 'alice@tinycld.org' }],
                in_reply_to: 'dbmigration-2@tinycld.org',
                date: '2026-04-04 10:00:00.000Z',
                subject: 'Re: Database migration plan',
                snippet: 'Running it in staging now. Will report back.',
                body_html: '<p>Good call. Running it in staging now. Will report back this afternoon.</p><p>Bob</p>',
            },
            {
                sender_name: 'Bob Park',
                sender_email: 'bob.park@tinycld.org',
                recipients_to: [{ name: 'Alice', email: 'alice@tinycld.org' }],
                in_reply_to: 'dbmigration-3@tinycld.org',
                date: '2026-04-04 16:00:00.000Z',
                subject: 'Re: Database migration plan',
                snippet: 'Staging migration complete — all good. Ready to schedule production.',
                body_html:
                    '<p>Staging migration complete — all tests passing, no performance regressions. Ready to schedule production whenever you give the green light.</p><p>Bob</p>',
            },
        ],
    },
    {
        subject: 'Slack Connect invite from Acme Corp',
        snippet: 'Carol Williams has invited you to connect on Slack. Join the #acme-tinycld channel.',
        message_count: 1,
        latest_date: '2026-04-05 09:00:00.000Z',
        participants: [{ name: 'Slack', email: 'notifications@slack.com' }],
        folder: 'inbox',
        is_read: true,
        is_starred: false,
        labels: ['Clients'],
        messages: [
            {
                sender_name: 'Slack',
                sender_email: 'notifications@slack.com',
                recipients_to: [{ name: 'Alice', email: 'alice@tinycld.org' }],
                date: '2026-04-05 09:00:00.000Z',
                subject: 'Slack Connect invite from Acme Corp',
                snippet: 'Carol Williams invited you to join #acme-tinycld.',
                body_html:
                    '<p><strong>Carol Williams</strong> from Acme Corp has invited you to connect on Slack.</p><p>Channel: <strong>#acme-tinycld</strong></p><p>Accept this invite to start collaborating with the Acme team directly in Slack.</p>',
            },
        ],
    },
    {
        subject: 'Team standup notes — April 3',
        snippet: 'Standup summary: onboarding designs in review, rate limiter PoC in progress, new hire starts Monday.',
        message_count: 1,
        latest_date: '2026-04-03 17:30:00.000Z',
        participants: [{ name: 'Alice', email: 'alice@tinycld.org' }],
        folder: 'sent',
        is_read: true,
        is_starred: false,
        labels: ['Work'],
        messages: [
            {
                sender_name: 'Alice',
                sender_email: 'alice@tinycld.org',
                recipients_to: [{ name: 'Team', email: 'support@tinycld.org' }],
                date: '2026-04-03 17:30:00.000Z',
                subject: 'Team standup notes — April 3',
                snippet: 'Standup summary: onboarding designs in review, rate limiter PoC in progress.',
                body_html:
                    '<p>Standup summary for April 3:</p><ul><li>Onboarding flow designs in review (Rachel)</li><li>Rate limiter PoC in progress (Jorge)</li><li>Contact import PR ready for review (Sarah)</li><li>New hire Priya starts Monday</li></ul><p>Alice</p>',
            },
        ],
    },
    {
        subject: 'Team standup notes — April 7',
        snippet: 'Standup summary: CI flakiness fixed, migration staged, offsite RSVPs due April 15.',
        message_count: 1,
        latest_date: '2026-04-07 17:30:00.000Z',
        participants: [{ name: 'Alice', email: 'alice@tinycld.org' }],
        folder: 'sent',
        is_read: true,
        is_starred: false,
        labels: ['Work'],
        messages: [
            {
                sender_name: 'Alice',
                sender_email: 'alice@tinycld.org',
                recipients_to: [{ name: 'Team', email: 'support@tinycld.org' }],
                date: '2026-04-07 17:30:00.000Z',
                subject: 'Team standup notes — April 7',
                snippet: 'Standup summary: CI flakiness fixed, migration staged.',
                body_html:
                    '<p>Standup summary for April 7:</p><ul><li>CI flakiness fixed — was a race condition in the test setup (Bob)</li><li>DB migration ran successfully in staging (Bob)</li><li>Onboarding designs approved — dev starting this sprint (Rachel)</li><li>Offsite RSVPs due April 15</li></ul><p>Alice</p>',
            },
        ],
    },
    {
        subject: 'Updated PTO policy',
        snippet: "We've updated our PTO policy for 2026. Key changes: unlimited PTO for tenured employees.",
        message_count: 1,
        latest_date: '2026-03-20 10:00:00.000Z',
        participants: [{ name: 'HR Team', email: 'hr@tinycld.org' }],
        folder: 'inbox',
        is_read: true,
        is_starred: false,
        labels: [],
        messages: [
            {
                sender_name: 'HR Team',
                sender_email: 'hr@tinycld.org',
                recipients_to: [{ name: 'All Staff', email: 'all@tinycld.org' }],
                date: '2026-03-20 10:00:00.000Z',
                subject: 'Updated PTO policy',
                snippet: "We've updated our PTO policy for 2026.",
                body_html:
                    "<p>Hi everyone,</p><p>We've updated our PTO policy effective April 1, 2026. Key changes:</p><ul><li>Unlimited PTO for employees with 2+ years tenure</li><li>Minimum 2 weeks required per year</li><li>Manager approval still required for blocks > 5 days</li></ul><p>Full policy available on the wiki.</p><p>— HR Team</p>",
            },
        ],
    },
    {
        subject: 'Linear digest: 8 issues updated',
        snippet: 'ENG-342 moved to In Review, ENG-338 closed, ENG-351 assigned to you.',
        message_count: 1,
        latest_date: '2026-04-07 18:00:00.000Z',
        participants: [{ name: 'Linear', email: 'notifications@linear.app' }],
        folder: 'inbox',
        is_read: false,
        is_starred: false,
        labels: ['Work'],
        messages: [
            {
                sender_name: 'Linear',
                sender_email: 'notifications@linear.app',
                recipients_to: [{ name: 'Alice', email: 'alice@tinycld.org' }],
                date: '2026-04-07 18:00:00.000Z',
                subject: 'Linear digest: 8 issues updated',
                snippet: 'ENG-342 moved to In Review, ENG-338 closed.',
                body_html:
                    '<p><strong>8 issues updated today</strong></p><ul><li>ENG-342: Contact import — moved to <em>In Review</em></li><li>ENG-338: Fix email threading — <em>Closed</em></li><li>ENG-351: Rate limiter implementation — <em>Assigned to you</em></li><li>ENG-347: Onboarding redesign — <em>In Progress</em></li><li>4 other updates</li></ul>',
            },
        ],
    },
    {
        subject: 'Re: Client feedback — Acme Corp',
        snippet: 'They loved the demo! A few feature requests from their team.',
        message_count: 3,
        latest_date: '2026-04-06 14:00:00.000Z',
        participants: [
            { name: 'David Lee', email: 'david.lee@tinycld.org' },
            { name: 'Alice', email: 'alice@tinycld.org' },
        ],
        folder: 'inbox',
        is_read: true,
        is_starred: true,
        labels: ['Work', 'Clients'],
        messages: [
            {
                sender_name: 'David Lee',
                sender_email: 'david.lee@tinycld.org',
                recipients_to: [{ name: 'Alice', email: 'alice@tinycld.org' }],
                date: '2026-04-05 15:00:00.000Z',
                subject: 'Client feedback — Acme Corp',
                snippet: 'Just wrapped up the demo with Acme. They loved it!',
                body_html:
                    "<p>Alice,</p><p>Just wrapped up the demo with Acme Corp. They loved the new drive sharing features! A few requests:</p><ol><li>Bulk contact import from their CRM</li><li>SSO integration (SAML)</li><li>Custom branding on shared links</li></ol><p>Carol said she'd send a formal list by end of week.</p><p>David</p>",
            },
            {
                sender_name: 'Alice',
                sender_email: 'alice@tinycld.org',
                recipients_to: [{ name: 'David Lee', email: 'david.lee@tinycld.org' }],
                in_reply_to: 'acme-feedback-1@tinycld.org',
                date: '2026-04-06 09:30:00.000Z',
                subject: 'Re: Client feedback — Acme Corp',
                snippet: 'Great news! SSO is already on the Q2 roadmap.',
                body_html:
                    "<p>Great news! SSO is already on the Q2 roadmap, and bulk import is in Sarah's PR right now. Custom branding is new — let me add it to the backlog.</p><p>Alice</p>",
            },
            {
                sender_name: 'David Lee',
                sender_email: 'david.lee@tinycld.org',
                recipients_to: [{ name: 'Alice', email: 'alice@tinycld.org' }],
                in_reply_to: 'acme-feedback-2@tinycld.org',
                date: '2026-04-06 14:00:00.000Z',
                subject: 'Re: Client feedback — Acme Corp',
                snippet: "Perfect. Carol will be thrilled. I'll set up a follow-up call next week.",
                body_html:
                    "<p>Perfect. Carol will be thrilled. I'll set up a follow-up call next week to walk them through the import feature once it ships.</p><p>David</p>",
            },
        ],
    },
    {
        subject: 'Cloudflare DDoS attack mitigated',
        snippet: 'A DDoS attack targeting your domain was automatically mitigated. No action required.',
        message_count: 1,
        latest_date: '2026-04-02 03:15:00.000Z',
        participants: [{ name: 'Cloudflare', email: 'noreply@notify.cloudflare.com' }],
        folder: 'inbox',
        is_read: true,
        is_starred: false,
        labels: [],
        messages: [
            {
                sender_name: 'Cloudflare',
                sender_email: 'noreply@notify.cloudflare.com',
                recipients_to: [{ name: 'Alice', email: 'alice@tinycld.org' }],
                date: '2026-04-02 03:15:00.000Z',
                subject: 'Cloudflare DDoS attack mitigated',
                snippet: 'A DDoS attack targeting your domain was automatically mitigated.',
                body_html:
                    '<p><strong>DDoS Attack Mitigated</strong></p><p>A DDoS attack targeting <code>app.tinycld.org</code> was automatically mitigated.</p><p><strong>Duration:</strong> 12 minutes<br/><strong>Peak:</strong> 2.3 Gbps<br/><strong>Type:</strong> HTTP flood<br/><strong>Status:</strong> Mitigated — no impact to your origin</p><p>No action is required. View the attack analytics in your Cloudflare dashboard.</p>',
            },
        ],
    },
    {
        subject: 'Gym membership renewal',
        snippet: 'Your annual membership at FitLife Gym expires on April 30. Renew now to keep your rate.',
        message_count: 1,
        latest_date: '2026-04-01 09:00:00.000Z',
        participants: [{ name: 'FitLife Gym', email: 'membership@fitlifegym.com' }],
        folder: 'inbox',
        is_read: true,
        is_starred: false,
        labels: ['Personal'],
        messages: [
            {
                sender_name: 'FitLife Gym',
                sender_email: 'membership@fitlifegym.com',
                recipients_to: [{ name: 'Alice', email: 'alice@tinycld.org' }],
                date: '2026-04-01 09:00:00.000Z',
                subject: 'Gym membership renewal',
                snippet: 'Your annual membership expires April 30. Renew to keep your rate.',
                body_html:
                    '<p>Hi Alice,</p><p>Your annual membership at FitLife Gym expires on <strong>April 30, 2026</strong>.</p><p>Renew before April 15 to lock in your current rate of <strong>$49/month</strong>. After that, the rate increases to $59/month.</p><p>— FitLife Gym</p>',
            },
        ],
    },
    {
        subject: 'Draft: Q2 OKRs',
        snippet: 'Draft OKRs for Q2. Need to finalize metrics and get sign-off from David.',
        message_count: 1,
        latest_date: '2026-04-06 20:00:00.000Z',
        participants: [{ name: 'Alice', email: 'alice@tinycld.org' }],
        folder: 'drafts',
        is_read: true,
        is_starred: false,
        labels: [],
        messages: [
            {
                sender_name: 'Alice',
                sender_email: 'alice@tinycld.org',
                recipients_to: [{ name: 'David Lee', email: 'david.lee@tinycld.org' }],
                date: '2026-04-06 20:00:00.000Z',
                subject: 'Draft: Q2 OKRs',
                snippet: 'Draft OKRs for Q2.',
                body_html:
                    '<p><strong>Q2 2026 OKRs — Draft</strong></p><p><strong>Objective 1:</strong> Launch public API</p><ul><li>KR: 95% uptime in first month</li><li>KR: 10 external integrations in beta</li></ul><p><strong>Objective 2:</strong> Grow enterprise pipeline</p><ul><li>KR: 5 new enterprise trials</li><li>KR: Close 2 annual contracts</li></ul><p>TODO: Finalize metrics, get sign-off from David</p>',
            },
        ],
    },
    {
        subject: 'Re: Podcast interview request',
        snippet: "We'd love to have you on the show to talk about building developer tools.",
        message_count: 2,
        latest_date: '2026-03-25 13:00:00.000Z',
        participants: [
            { name: 'Jamie Torres', email: 'jamie@devtalkpodcast.com' },
            { name: 'Alice', email: 'alice@tinycld.org' },
        ],
        folder: 'inbox',
        is_read: true,
        is_starred: false,
        labels: ['Personal'],
        messages: [
            {
                sender_name: 'Jamie Torres',
                sender_email: 'jamie@devtalkpodcast.com',
                recipients_to: [{ name: 'Alice', email: 'alice@tinycld.org' }],
                date: '2026-03-24 10:00:00.000Z',
                subject: 'Podcast interview request',
                snippet: "We'd love to have you on DevTalk to discuss building developer tools.",
                body_html:
                    "<p>Hi Alice,</p><p>I host the DevTalk podcast and we'd love to have you on the show to talk about building developer tools and the TinyCld journey.</p><p>We typically record on Thursdays, 30-45 minutes. Would any Thursday in April work for you?</p><p>Best,<br/>Jamie Torres</p>",
            },
            {
                sender_name: 'Alice',
                sender_email: 'alice@tinycld.org',
                recipients_to: [{ name: 'Jamie Torres', email: 'jamie@devtalkpodcast.com' }],
                in_reply_to: 'podcast-1@tinycld.org',
                date: '2026-03-25 13:00:00.000Z',
                subject: 'Re: Podcast interview request',
                snippet: 'Sounds fun! April 17 works for me.',
                body_html:
                    "<p>Hi Jamie,</p><p>Sounds fun! April 17 works for me. Happy to talk about the dev tools space and what we're building at TinyCld.</p><p>Alice</p>",
            },
        ],
    },
    {
        subject: 'Sentry alert: high error rate in production',
        snippet: 'Error rate exceeded threshold (>5%) in the mail service. 23 events in the last hour.',
        message_count: 1,
        latest_date: '2026-04-06 23:30:00.000Z',
        participants: [{ name: 'Sentry', email: 'noreply@sentry.io' }],
        folder: 'inbox',
        is_read: false,
        is_starred: false,
        labels: ['Work', 'Urgent'],
        messages: [
            {
                sender_name: 'Sentry',
                sender_email: 'noreply@sentry.io',
                recipients_to: [{ name: 'Alice', email: 'alice@tinycld.org' }],
                date: '2026-04-06 23:30:00.000Z',
                subject: 'Sentry alert: high error rate in production',
                snippet: 'Error rate exceeded threshold (>5%) in the mail service.',
                body_html:
                    "<p><strong>Alert: High Error Rate</strong></p><p>Project: tinycld-api<br/>Service: mail<br/>Error rate: <strong>7.2%</strong> (threshold: 5%)</p><p>23 events in the last hour. Most common:</p><ul><li><code>TypeError: Cannot read property 'id' of undefined</code> (18 events)</li><li><code>TimeoutError: IMAP connection timed out</code> (5 events)</li></ul>",
            },
        ],
    },
    {
        subject: 'Google Workspace storage warning',
        snippet: 'Your organization is using 89% of its storage quota. Consider upgrading your plan.',
        message_count: 1,
        latest_date: '2026-03-18 08:00:00.000Z',
        participants: [{ name: 'Google Workspace', email: 'no-reply@accounts.google.com' }],
        folder: 'inbox',
        is_read: true,
        is_starred: false,
        labels: [],
        messages: [
            {
                sender_name: 'Google Workspace',
                sender_email: 'no-reply@accounts.google.com',
                recipients_to: [{ name: 'Alice', email: 'alice@tinycld.org' }],
                date: '2026-03-18 08:00:00.000Z',
                subject: 'Google Workspace storage warning',
                snippet: 'Your organization is using 89% of its storage quota.',
                body_html:
                    '<p>Your Google Workspace organization is using <strong>89%</strong> of its storage quota (133.5 GB of 150 GB).</p><p>Top users by storage:</p><ul><li>alice@tinycld.org — 45.2 GB</li><li>bob.park@tinycld.org — 38.7 GB</li><li>shared drives — 32.1 GB</li></ul><p>Consider upgrading to Business Plus for 5 TB per user.</p>',
            },
        ],
    },
    {
        subject: 'Invitation: 1:1 with David — recurring',
        snippet: 'David Lee has invited you to a recurring event: 1:1 sync, every Tuesday at 10 AM.',
        message_count: 1,
        latest_date: '2026-03-22 09:00:00.000Z',
        participants: [{ name: 'Google Calendar', email: 'calendar-notification@google.com' }],
        folder: 'inbox',
        is_read: true,
        is_starred: false,
        labels: [],
        messages: [
            {
                sender_name: 'Google Calendar',
                sender_email: 'calendar-notification@google.com',
                recipients_to: [{ name: 'Alice', email: 'alice@tinycld.org' }],
                date: '2026-03-22 09:00:00.000Z',
                subject: 'Invitation: 1:1 with David — recurring',
                snippet: 'David Lee invited you to: 1:1 sync, every Tuesday at 10 AM.',
                body_html:
                    '<p><strong>1:1 with David</strong></p><p>When: Every Tuesday, 10:00 AM - 10:30 AM<br/>Where: Zoom (link in calendar event)<br/>Organizer: David Lee</p><p>Accept | Decline | Tentative</p>',
            },
        ],
    },
    {
        subject: 'New comment on ENG-351',
        snippet: 'Jorge Mendez commented: "PoC is ready for review. Branch: feature/rate-limiter."',
        message_count: 1,
        latest_date: '2026-04-07 15:30:00.000Z',
        participants: [{ name: 'Linear', email: 'notifications@linear.app' }],
        folder: 'inbox',
        is_read: false,
        is_starred: false,
        labels: ['Work'],
        messages: [
            {
                sender_name: 'Linear',
                sender_email: 'notifications@linear.app',
                recipients_to: [{ name: 'Alice', email: 'alice@tinycld.org' }],
                date: '2026-04-07 15:30:00.000Z',
                subject: 'New comment on ENG-351',
                snippet: 'Jorge Mendez: "PoC is ready for review."',
                body_html:
                    '<p><strong>ENG-351: Rate limiter implementation</strong></p><p><strong>Jorge Mendez</strong> commented:</p><blockquote>PoC is ready for review. Branch: <code>feature/rate-limiter</code>. I went with token bucket as discussed. Handles 10k req/s in benchmarks with <2ms overhead.</blockquote>',
            },
        ],
    },
    {
        subject: 'Weekend plans?',
        snippet: 'A group of us are going hiking on Saturday. Want to join?',
        message_count: 1,
        latest_date: '2026-04-04 18:00:00.000Z',
        participants: [{ name: 'Sarah Kim', email: 'sarah.kim@tinycld.org' }],
        folder: 'inbox',
        is_read: true,
        is_starred: false,
        labels: ['Personal'],
        messages: [
            {
                sender_name: 'Sarah Kim',
                sender_email: 'sarah.kim@tinycld.org',
                recipients_to: [{ name: 'Alice', email: 'alice@tinycld.org' }],
                date: '2026-04-04 18:00:00.000Z',
                subject: 'Weekend plans?',
                snippet: 'A group of us are going hiking on Saturday.',
                body_html:
                    "<p>Hey Alice!</p><p>A group of us are going hiking at Muir Woods on Saturday morning. Want to join? We're meeting at the trailhead at 9 AM.</p><p>Sarah</p>",
            },
        ],
    },
    {
        subject: 'Your Vercel invoice — April 2026',
        snippet: 'Vercel Pro plan invoice: $20.00. Payment processed via Visa ending in 4242.',
        message_count: 1,
        latest_date: '2026-04-01 06:00:00.000Z',
        participants: [{ name: 'Vercel', email: 'billing@vercel.com' }],
        folder: 'inbox',
        is_read: true,
        is_starred: false,
        labels: ['Finance', 'Receipts'],
        messages: [
            {
                sender_name: 'Vercel',
                sender_email: 'billing@vercel.com',
                recipients_to: [{ name: 'Alice', email: 'alice@tinycld.org' }],
                date: '2026-04-01 06:00:00.000Z',
                subject: 'Your Vercel invoice — April 2026',
                snippet: 'Vercel Pro plan — April 2026: $20.00.',
                body_html:
                    '<p>Your Vercel Pro plan invoice for <strong>April 2026</strong>: <strong>$20.00</strong></p><p>Payment method: Visa ending in 4242<br/>Next billing date: May 1, 2026</p>',
            },
        ],
    },
    {
        subject: 'Reminder: dentist appointment tomorrow',
        snippet: 'This is a reminder of your appointment with Dr. Chen on April 8 at 2:30 PM.',
        message_count: 1,
        latest_date: '2026-04-07 16:00:00.000Z',
        participants: [{ name: 'Bay Area Dental', email: 'reminders@bayadental.com' }],
        folder: 'inbox',
        is_read: true,
        is_starred: false,
        labels: ['Personal'],
        messages: [
            {
                sender_name: 'Bay Area Dental',
                sender_email: 'reminders@bayadental.com',
                recipients_to: [{ name: 'Alice', email: 'alice@tinycld.org' }],
                date: '2026-04-07 16:00:00.000Z',
                subject: 'Reminder: dentist appointment tomorrow',
                snippet: 'Appointment with Dr. Chen on April 8 at 2:30 PM.',
                body_html:
                    '<p>Hi Alice,</p><p>This is a reminder of your appointment:</p><p><strong>Date:</strong> April 8, 2026<br/><strong>Time:</strong> 2:30 PM<br/><strong>Doctor:</strong> Dr. Chen<br/><strong>Type:</strong> Regular checkup & cleaning</p><p>Please arrive 10 minutes early. Reply to reschedule.</p>',
            },
        ],
    },
    {
        subject: "Spam: You've won a free cruise!",
        snippet: "Congratulations! You've been selected to win a free Caribbean cruise. Click here to claim.",
        message_count: 1,
        latest_date: '2026-04-05 04:00:00.000Z',
        participants: [{ name: 'Prize Center', email: 'winner@totally-real-prizes.biz' }],
        folder: 'spam',
        is_read: false,
        is_starred: false,
        labels: [],
        messages: [
            {
                sender_name: 'Prize Center',
                sender_email: 'winner@totally-real-prizes.biz',
                recipients_to: [{ name: 'Alice', email: 'alice@tinycld.org' }],
                date: '2026-04-05 04:00:00.000Z',
                subject: "You've won a free cruise!",
                snippet: "Congratulations! You've been selected to win a free Caribbean cruise.",
                body_html:
                    '<p style="color: red; font-size: 24px">CONGRATULATIONS!!!</p><p>You\'ve been selected to win a FREE 7-day Caribbean cruise! Click below to claim your prize NOW!</p><p>This offer expires in 24 hours!</p>',
            },
        ],
    },
    {
        subject: 'Spam: Urgent business proposal',
        snippet: 'Dear Sir/Madam, I am writing to inform you of a lucrative business opportunity.',
        message_count: 1,
        latest_date: '2026-04-03 01:00:00.000Z',
        participants: [{ name: 'Dr. James Okafor', email: 'james.okafor@biz-opportunity.net' }],
        folder: 'spam',
        is_read: false,
        is_starred: false,
        labels: [],
        messages: [
            {
                sender_name: 'Dr. James Okafor',
                sender_email: 'james.okafor@biz-opportunity.net',
                recipients_to: [{ name: 'Alice', email: 'alice@tinycld.org' }],
                date: '2026-04-03 01:00:00.000Z',
                subject: 'Urgent business proposal',
                snippet: 'Dear Sir/Madam, I have a lucrative business opportunity.',
                body_html:
                    '<p>Dear Sir/Madam,</p><p>I am Dr. James Okafor, a senior financial advisor. I am writing to inform you of a lucrative business opportunity involving the transfer of $4.5 million USD. Your assistance is required.</p><p>Please reply with your full name and bank details.</p>',
            },
        ],
    },
    {
        subject: 'Old project files — archive?',
        snippet: "Hey Alice, can we archive the v1 project files? They're taking up a lot of space.",
        message_count: 1,
        latest_date: '2026-03-10 11:00:00.000Z',
        participants: [{ name: 'Bob Park', email: 'bob.park@tinycld.org' }],
        folder: 'trash',
        is_read: true,
        is_starred: false,
        labels: [],
        messages: [
            {
                sender_name: 'Bob Park',
                sender_email: 'bob.park@tinycld.org',
                recipients_to: [{ name: 'Alice', email: 'alice@tinycld.org' }],
                date: '2026-03-10 11:00:00.000Z',
                subject: 'Old project files — archive?',
                snippet: 'Can we archive the v1 project files?',
                body_html:
                    "<p>Hey Alice,</p><p>Can we archive the v1 project files in Drive? They're taking up about 8 GB and nobody's touched them in 6 months.</p><p>Bob</p>",
            },
        ],
    },
    {
        subject: 'Meeting notes — product review',
        snippet: "Notes from yesterday's product review. Action items at the bottom.",
        message_count: 1,
        latest_date: '2026-04-08 09:00:00.000Z',
        participants: [{ name: 'Alice', email: 'alice@tinycld.org' }],
        folder: 'sent',
        is_read: true,
        is_starred: false,
        labels: ['Work'],
        messages: [
            {
                sender_name: 'Alice',
                sender_email: 'alice@tinycld.org',
                recipients_to: [{ name: 'Team', email: 'support@tinycld.org' }],
                date: '2026-04-08 09:00:00.000Z',
                subject: 'Meeting notes — product review',
                snippet: "Notes from yesterday's product review.",
                body_html:
                    "<p>Hi team,</p><p>Notes from yesterday's product review:</p><ul><li>SSO timeline moved up to Sprint 15 per Acme request</li><li>Mobile app v2.1 approved for release</li><li>Drive sharing redesign postponed to Q3</li></ul><p><strong>Action items:</strong></p><ul><li>Bob: start SSO spike this sprint</li><li>Sarah: submit mobile app to App Store</li><li>Rachel: finalize drive sharing mockups for Q3 planning</li></ul><p>Alice</p>",
            },
        ],
    },
    {
        subject: 'Feedback on the new calendar view',
        snippet: 'The 3-day view is really nice. One issue: events overlap when there are too many.',
        message_count: 2,
        latest_date: '2026-04-08 11:30:00.000Z',
        participants: [
            { name: 'Marcus Johnson', email: 'marcus.j@tinycld.org' },
            { name: 'Alice', email: 'alice@tinycld.org' },
        ],
        folder: 'inbox',
        is_read: false,
        is_starred: false,
        labels: ['Work'],
        messages: [
            {
                sender_name: 'Marcus Johnson',
                sender_email: 'marcus.j@tinycld.org',
                recipients_to: [{ name: 'Alice', email: 'alice@tinycld.org' }],
                date: '2026-04-08 10:00:00.000Z',
                subject: 'Feedback on the new calendar view',
                snippet: 'The 3-day view is really nice. One issue though.',
                body_html:
                    '<p>Hey Alice,</p><p>The new 3-day calendar view is really nice — much better for weekly planning. One issue: when there are more than 4 concurrent events, they overlap and become unreadable.</p><p>Maybe we could show a "+3 more" indicator instead?</p><p>Marcus</p>',
            },
            {
                sender_name: 'Alice',
                sender_email: 'alice@tinycld.org',
                recipients_to: [{ name: 'Marcus Johnson', email: 'marcus.j@tinycld.org' }],
                in_reply_to: 'calendar-feedback-1@tinycld.org',
                date: '2026-04-08 11:30:00.000Z',
                subject: 'Re: Feedback on the new calendar view',
                snippet: "Good catch! I'll file a ticket for the overflow handling.",
                body_html:
                    '<p>Good catch! I\'ll file a ticket for the overflow handling. The "+N more" approach is what Google Calendar does and it works well.</p><p>Thanks for the feedback!</p><p>Alice</p>',
            },
        ],
    },
    {
        subject: 'npm advisory: critical vulnerability in lodash',
        snippet: 'A critical vulnerability (CVE-2026-1234) has been found in lodash < 4.17.22.',
        message_count: 1,
        latest_date: '2026-04-07 20:00:00.000Z',
        participants: [{ name: 'npm Security', email: 'security@npmjs.com' }],
        folder: 'inbox',
        is_read: false,
        is_starred: false,
        labels: ['Work', 'Urgent'],
        messages: [
            {
                sender_name: 'npm Security',
                sender_email: 'security@npmjs.com',
                recipients_to: [{ name: 'Alice', email: 'alice@tinycld.org' }],
                date: '2026-04-07 20:00:00.000Z',
                subject: 'npm advisory: critical vulnerability in lodash',
                snippet: 'Critical vulnerability (CVE-2026-1234) in lodash < 4.17.22.',
                body_html:
                    '<p><strong>Critical Security Advisory</strong></p><p>A critical prototype pollution vulnerability (<strong>CVE-2026-1234</strong>) has been found in <code>lodash</code> versions prior to 4.17.22.</p><p>Affected packages in your project:</p><ul><li><code>@tinycld/core</code> — lodash@4.17.21</li></ul><p>Run <code>npm audit fix</code> to update.</p>',
            },
        ],
    },
    {
        subject: 'Package delivered',
        snippet: 'Your Amazon order has been delivered to your front door.',
        message_count: 1,
        latest_date: '2026-04-06 16:30:00.000Z',
        participants: [{ name: 'Amazon', email: 'shipment-tracking@amazon.com' }],
        folder: 'inbox',
        is_read: true,
        is_starred: false,
        labels: ['Personal'],
        messages: [
            {
                sender_name: 'Amazon',
                sender_email: 'shipment-tracking@amazon.com',
                recipients_to: [{ name: 'Alice', email: 'alice@tinycld.org' }],
                date: '2026-04-06 16:30:00.000Z',
                subject: 'Package delivered',
                snippet: 'Your Amazon order has been delivered.',
                body_html:
                    '<p>Your package has been delivered!</p><p><strong>Order #112-3456789-0123456</strong></p><p>Delivered to: Front door</p><p>Items:<br/>- USB-C Hub (7-in-1) × 1<br/>- Webcam Cover Slides (3-pack) × 1</p>',
            },
        ],
    },
]

const SHARED_THREADS: typeof THREADS = [
    {
        subject: 'Refund request for order #84210',
        snippet:
            "Hi Support, I'd like to request a refund for order #84210 — the package arrived damaged. I've attached photos of the box.",
        message_count: 1,
        latest_date: '2026-04-04 11:15:00.000Z',
        participants: [{ name: 'Jordan Reeves', email: 'jordan.reeves@example.com' }],
        folder: 'inbox',
        is_read: false,
        is_starred: false,
        labels: ['Clients'],
        messages: [
            {
                sender_name: 'Jordan Reeves',
                sender_email: 'jordan.reeves@example.com',
                recipients_to: [{ name: 'Support', email: 'support@tinycld.org' }],
                date: '2026-04-04 11:15:00.000Z',
                subject: 'Refund request for order #84210',
                snippet: "I'd like to request a refund for order #84210.",
                body_html:
                    "<p>Hi Support,</p><p>I'd like to request a refund for order #84210 — the package arrived damaged. I've attached photos of the box and the contents.</p><p>Order placed: April 1, 2026<br/>Tracking: 1Z999AA10123456784</p><p>Thanks,<br/>Jordan</p>",
            },
        ],
    },
    {
        subject: 'API rate limit question',
        snippet:
            'Hello — we just upgraded to the Pro plan and are seeing 429s on our webhook ingest. The docs say 1000 req/min but we hit limits at ~400. Can you check the account?',
        message_count: 1,
        latest_date: '2026-04-03 17:42:00.000Z',
        participants: [{ name: 'Priya Natarajan', email: 'priya@orbitlabs.io' }],
        folder: 'inbox',
        is_read: false,
        is_starred: true,
        labels: ['Urgent', 'Clients'],
        messages: [
            {
                sender_name: 'Priya Natarajan',
                sender_email: 'priya@orbitlabs.io',
                recipients_to: [{ name: 'Support', email: 'support@tinycld.org' }],
                date: '2026-04-03 17:42:00.000Z',
                subject: 'API rate limit question',
                snippet: 'We just upgraded to Pro and are seeing 429s on our webhook ingest.',
                body_html:
                    '<p>Hello,</p><p>We just upgraded to the Pro plan and are seeing 429s on our webhook ingest. The docs say 1000 req/min but we hit limits at ~400.</p><p>Account: orbitlabs<br/>Endpoint: <code>POST /v1/events</code></p><p>Can you check the account configuration?</p><p>Thanks,<br/>Priya</p>',
            },
        ],
    },
    {
        subject: 'Thank you!',
        snippet:
            'Just wanted to say your team has been incredible to work with. The migration went smoothly and our customers love the new flow.',
        message_count: 1,
        latest_date: '2026-04-02 10:05:00.000Z',
        participants: [{ name: 'Daniel Okafor', email: 'daniel@brightside.co' }],
        folder: 'inbox',
        is_read: true,
        is_starred: false,
        labels: ['Clients'],
        messages: [
            {
                sender_name: 'Daniel Okafor',
                sender_email: 'daniel@brightside.co',
                recipients_to: [{ name: 'Support', email: 'support@tinycld.org' }],
                date: '2026-04-02 10:05:00.000Z',
                subject: 'Thank you!',
                snippet: 'Your team has been incredible to work with.',
                body_html:
                    '<p>Hi team,</p><p>Just wanted to say your team has been incredible to work with. The migration went smoothly and our customers love the new flow.</p><p>Big thanks to whoever stayed late on Tuesday to push the DNS changes through. Above and beyond.</p><p>Cheers,<br/>Daniel</p>',
            },
        ],
    },
    {
        subject: 'Invoice question — line item discrepancy',
        snippet:
            "Hi, on invoice INV-2026-0331 we're seeing a line item for 'Premium add-on' that we don't recall enabling. Could you clarify?",
        message_count: 1,
        latest_date: '2026-04-01 09:20:00.000Z',
        participants: [{ name: 'Helena Ortiz', email: 'helena.ortiz@northwind.example' }],
        folder: 'inbox',
        is_read: true,
        is_starred: false,
        labels: ['Finance', 'Clients'],
        messages: [
            {
                sender_name: 'Helena Ortiz',
                sender_email: 'helena.ortiz@northwind.example',
                recipients_to: [{ name: 'Support', email: 'support@tinycld.org' }],
                date: '2026-04-01 09:20:00.000Z',
                subject: 'Invoice question — line item discrepancy',
                snippet: "We're seeing a line item we don't recall enabling.",
                body_html:
                    "<p>Hi,</p><p>On invoice INV-2026-0331 we're seeing a line item for 'Premium add-on' ($29.00) that we don't recall enabling.</p><p>Could you clarify when this was added and whether we can remove it going forward?</p><p>Best,<br/>Helena Ortiz<br/>Finance, Northwind</p>",
            },
        ],
    },
    {
        subject: 'Hippo photo from the safari',
        snippet: 'Spotted this beauty at the watering hole on day three — couldn’t believe how close he came.',
        message_count: 1,
        latest_date: '2026-05-01 18:30:00.000Z',
        participants: [{ name: 'Priya Sharma', email: 'priya.sharma@tinycld.org' }],
        folder: 'inbox',
        is_read: false,
        is_starred: true,
        labels: ['Personal'],
        messages: [
            {
                sender_name: 'Priya Sharma',
                sender_email: 'priya.sharma@tinycld.org',
                recipients_to: [{ name: 'Team', email: 'support@tinycld.org' }],
                date: '2026-05-01 18:30:00.000Z',
                subject: 'Hippo photo from the safari',
                snippet: 'Spotted this beauty at the watering hole on day three — couldn’t believe how close he came.',
                body_html:
                    '<p>Hey all,</p><p>Spotted this beauty at the watering hole on day three. Couldn’t believe how close he came to the boat.</p><p>More pics coming once I sort through the SD card.</p><p>— Priya</p>',
                attachments: ['hippo.jpg'],
            },
        ],
    },
    {
        subject: 'Re: Hippo conservation status update',
        snippet: 'Attaching the photo I took last month for the newsletter — feel free to use it.',
        message_count: 2,
        latest_date: '2026-04-30 11:15:00.000Z',
        participants: [
            { name: 'Marcus Johnson', email: 'marcus.johnson@tinycld.org' },
            { name: 'Rachel Moore', email: 'rachel.moore@tinycld.org' },
        ],
        folder: 'inbox',
        is_read: false,
        is_starred: false,
        labels: ['Work'],
        messages: [
            {
                sender_name: 'Rachel Moore',
                sender_email: 'rachel.moore@tinycld.org',
                recipients_to: [{ name: 'Marcus Johnson', email: 'marcus.johnson@tinycld.org' }],
                date: '2026-04-29 14:00:00.000Z',
                subject: 'Hippo conservation status update',
                snippet: 'Marcus — do you have any recent hippo photos we could include in the May newsletter?',
                body_html:
                    '<p>Marcus,</p><p>Do you have any recent hippo photos we could include in the May newsletter? Trying to lead with something visually striking.</p><p>— Rachel</p>',
            },
            {
                sender_name: 'Marcus Johnson',
                sender_email: 'marcus.johnson@tinycld.org',
                recipients_to: [{ name: 'Rachel Moore', email: 'rachel.moore@tinycld.org' }],
                in_reply_to: 'hippo-conservation-status-update-1@tinycld.org',
                date: '2026-04-30 11:15:00.000Z',
                subject: 'Re: Hippo conservation status update',
                snippet: 'Attaching the photo I took last month for the newsletter — feel free to use it.',
                body_html:
                    '<p>Rachel,</p><p>Here you go — feel free to crop or recolor as needed for the layout.</p><p>— Marcus</p>',
                attachments: ['hippo.jpg'],
            },
        ],
    },
    {
        subject: 'Hippo plush toy fundraiser kickoff',
        snippet: 'Mock-up attached. Quote from the supplier comes in tomorrow; orders open Friday.',
        message_count: 1,
        latest_date: '2026-04-29 09:00:00.000Z',
        participants: [{ name: 'Sarah Kim', email: 'sarah.kim@tinycld.org' }],
        folder: 'inbox',
        is_read: true,
        is_starred: false,
        labels: ['Work', 'Newsletters'],
        messages: [
            {
                sender_name: 'Sarah Kim',
                sender_email: 'sarah.kim@tinycld.org',
                recipients_to: [{ name: 'Team', email: 'support@tinycld.org' }],
                date: '2026-04-29 09:00:00.000Z',
                subject: 'Hippo plush toy fundraiser kickoff',
                snippet: 'Mock-up attached. Quote from the supplier comes in tomorrow; orders open Friday.',
                body_html:
                    '<p>Team,</p><p>Mock-up of the hippo plush is attached. The supplier quote lands tomorrow; we’ll open pre-orders on Friday.</p><p>— Sarah</p>',
                attachments: ['hippo.jpg'],
            },
        ],
    },
]

function deriveAddress(email: string) {
    return (
        email
            .split('@')[0]
            .toLowerCase()
            .replace(/[^a-z0-9._-]/g, '') || 'user'
    )
}

async function findUniqueAddress(pb: PocketBase, base: string, domainId: string) {
    let address = base
    let suffix = 2
    while (true) {
        try {
            await pb.collection('mail_mailboxes').getFirstListItem(`address = "${address}" && domain = "${domainId}"`)
            address = `${base}${suffix++}`
        } catch {
            return address
        }
    }
}

async function findOrCreatePersonalMailbox(
    pb: PocketBase,
    email: string,
    name: string,
    domainId: string,
    userOrgId: string
) {
    const base = deriveAddress(email)

    // Check if mailbox already exists
    try {
        const existing = await pb
            .collection('mail_mailboxes')
            .getFirstListItem(`address = "${base}" && domain = "${domainId}"`)
        return existing
    } catch {
        // Not found, create it
    }

    const address = await findUniqueAddress(pb, base, domainId)
    const mailbox = await pb.collection('mail_mailboxes').create({
        address,
        domain: domainId,
        display_name: name || address,
        type: 'personal',
    })

    await pb.collection('mail_mailbox_members').create({
        mailbox: mailbox.id,
        user_org: userOrgId,
        role: 'owner',
    })

    return mailbox
}

export default async function seed(pb: PocketBase, { user, org, userOrg }: SeedContext) {
    let domain: { id: string }
    try {
        domain = await pb.collection('mail_domains').getFirstListItem(`org = "${org.id}" && domain = "tinycld.org"`)
        log('Found existing mail domain: tinycld.org')
    } catch {
        log('Creating mail domain: tinycld.org')
        domain = await pb.collection('mail_domains').create({
            org: org.id,
            domain: 'tinycld.org',
            verified: true,
        })
    }

    log('Setting up personal mailbox for', user.email)
    const personalMailbox = await findOrCreatePersonalMailbox(pb, user.email, user.name, domain.id, userOrg.id)

    let sharedMailbox: { id: string }
    try {
        sharedMailbox = await pb
            .collection('mail_mailboxes')
            .getFirstListItem(`address = "support" && domain = "${domain.id}"`)
        log('Found existing shared mailbox: support')
    } catch {
        log('Creating shared mailbox: support')
        sharedMailbox = await pb.collection('mail_mailboxes').create({
            address: 'support',
            domain: domain.id,
            display_name: 'Support',
            type: 'shared',
        })

        await pb.collection('mail_mailbox_members').create({
            mailbox: sharedMailbox.id,
            user_org: userOrg.id,
            role: 'owner',
        })
    }

    // Create personal mailboxes for any other org members
    const otherMembers = await pb.collection('user_org').getFullList({
        filter: `org = "${org.id}" && id != "${userOrg.id}"`,
        expand: 'user',
    })
    if (otherMembers.length > 0) {
        log(`Setting up mailboxes for ${otherMembers.length} other org member(s)`)
    }
    for (const member of otherMembers) {
        const memberUser = member.expand?.user as { email: string; name: string } | undefined
        if (!memberUser) continue
        await findOrCreatePersonalMailbox(pb, memberUser.email, memberUser.name, domain.id, member.id)
    }

    // Create labels (find or create) — uses core 'labels' collection
    log(`Setting up ${LABELS.length} labels...`)
    const labelMap: Record<string, string> = {}
    for (const label of LABELS) {
        let record: { id: string }
        try {
            record = await pb.collection('labels').getFirstListItem(`org = "${org.id}" && name = "${label.name}"`)
        } catch {
            record = await pb.collection('labels').create({
                org: org.id,
                name: label.name,
                color: label.color,
            })
        }
        labelMap[label.name] = record.id
    }

    await seedThreadsForMailbox(pb, personalMailbox.id, userOrg.id, THREADS, labelMap, 'personal')
    await seedThreadsForMailbox(pb, sharedMailbox.id, userOrg.id, SHARED_THREADS, labelMap, 'shared')
}

async function seedThreadsForMailbox(
    pb: PocketBase,
    mailboxId: string,
    userOrgId: string,
    threads: typeof THREADS,
    labelMap: Record<string, string>,
    label: string
) {
    const existing = await pb.collection('mail_threads').getList(1, 1, {
        filter: `mailbox = "${mailboxId}"`,
    })
    if (existing.totalItems > 0) {
        log(`Skipping ${label} threads (${existing.totalItems} already exist)`)
        return
    }

    const totalMessages = threads.reduce((sum, t) => sum + t.messages.length, 0)
    log(`Creating ${threads.length} ${label} threads with ${totalMessages} messages...`)
    for (const thread of threads) {
        const threadRecord = await pb.collection('mail_threads').create({
            mailbox: mailboxId,
            subject: thread.subject,
            snippet: thread.snippet,
            message_count: thread.message_count,
            latest_date: thread.latest_date,
            participants: thread.participants,
        })

        for (let i = 0; i < thread.messages.length; i++) {
            const msg = thread.messages[i]
            const formData = new FormData()
            formData.append('thread', threadRecord.id)
            formData.append('sender_name', msg.sender_name)
            formData.append('sender_email', msg.sender_email)
            formData.append('recipients_to', JSON.stringify(msg.recipients_to))
            formData.append('recipients_cc', JSON.stringify([]))
            formData.append('date', msg.date)
            formData.append('subject', msg.subject)
            formData.append('snippet', msg.snippet)
            const attachmentFiles = (msg.attachments ?? []).map((name) => fixtureFile(name, mimeFromName(name)))
            formData.append('has_attachments', attachmentFiles.length > 0 ? 'true' : 'false')
            formData.append('body_html', htmlBlob(msg.body_html))
            for (const file of attachmentFiles) {
                formData.append('attachments', file, file.name)
            }

            if (msg.in_reply_to) {
                formData.append('in_reply_to', msg.in_reply_to)
            }

            const msgId = `<${thread.subject
                .toLowerCase()
                .replace(/[^a-z0-9]/g, '-')
                .slice(0, 30)}-${i + 1}@tinycld.org>`
            formData.append('message_id', msgId)

            await pb.collection('mail_messages').create(formData)
        }

        const labelIds = thread.labels.map((name) => labelMap[name]).filter(Boolean)

        const threadState = await pb.collection('mail_thread_state').create({
            thread: threadRecord.id,
            user_org: userOrgId,
            folder: thread.folder,
            is_read: thread.is_read,
            is_starred: thread.is_starred,
        })

        for (const labelId of labelIds) {
            await pb.collection('label_assignments').create({
                label: labelId,
                record_id: threadState.id,
                collection: 'mail_thread_state',
                user_org: userOrgId,
            })
        }
    }

    log(`Created ${threads.length} ${label} threads with ${totalMessages} messages`)
}
