#!/usr/bin/env -S npx tsx

/**
 * Database Seed Script
 *
 * Populates the PocketBase database with a target user, org, and package data.
 *
 * Usage:
 *   npx tsx scripts/seed-db.ts [options]
 *
 * Options:
 *   --mode <test|demo>     Preset (default: test)
 *                            test: user@tinycld.org + test-org (+ acme second org)
 *                            demo: demo@tinycld.org (is_demo=true) + demo org, single org
 *   --user-email <email>   Override user email
 *   --user-name <name>     Override user display name
 *   --user-pw <pw>         Override user password. In demo mode also honors
 *                          $REVIEW_DEMO_PASSWORD from .env, so the App Review
 *                          reviewer account has a stable password.
 *
 * Demo mode also honors $REVIEW_DEMO_EMAIL for the user's email field. Keep
 * it set to the demo singleton ("demo@tinycld.org") unless you also patch
 * demo_start.go's demoUserEmail constant; the demo-token flow looks the user
 * up by that email.
 *   --org-slug <slug>      Override primary org slug
 *   --org-name <name>      Override primary org name
 *   --url <url>            PocketBase URL (default: http://127.0.0.1:7100)
 *   --admin-email <email>  Superuser email
 *   --admin-pw <pw>        Superuser password
 *   --help                 Show this help message
 */

import { deriveSeeds } from '@tinycld/core/lib/packages/derive-seeds'
import PocketBase from 'pocketbase'
import { tinycldSeeds } from '../tinycld.seeds'

function log(...args: unknown[]) {
    process.stdout.write(`[seed] ${args.join(' ')}\n`)
}

function logError(...args: unknown[]) {
    process.stderr.write(`[seed] ${args.join(' ')}\n`)
}

try {
    process.loadEnvFile()
} catch {
    // .env may not exist in CI
}

type SeedMode = 'test' | 'demo'

interface SeedConfig {
    url: string
    adminEmail: string
    adminPassword: string
    mode: SeedMode
    userEmail: string
    userUsername: string
    userName: string
    userPassword: string
    isDemo: boolean
    orgSlug: string
    orgName: string
    seedSecondOrg: boolean
}

const TEST_DEFAULTS = {
    userEmail: process.env.TEST_USER_LOGIN || 'user@tinycld.org',
    userUsername: process.env.TEST_USER_USERNAME || 'tester',
    userName: 'Test User',
    userPassword: process.env.TEST_USER_PW || 'TestUser1234!',
    orgSlug: 'test-org',
    orgName: 'Test Organization',
}

// These mirror the singleton constants in
// core/server/coreserver/demo_start.go. Keep in sync.
// REVIEW_DEMO_EMAIL overrides userEmail at runtime; if you set it to
// something other than demo@tinycld.org you must also patch demo_start.go's
// demoUserEmail constant or the demo-token flow won't find the user.
const DEMO_DEFAULTS = {
    userEmail: process.env.REVIEW_DEMO_EMAIL || 'demo@tinycld.org',
    userUsername: 'demo',
    userName: 'Demo Tour',
    orgSlug: 'demo',
    orgName: 'Demo Workspace',
}

const SECOND_ORG_NAME = 'Acme Corp'
const SECOND_ORG_SLUG = 'acme'

function parseArgs(): SeedConfig {
    const args = process.argv.slice(2)
    let mode: SeedMode = 'test'
    const overrides: Partial<{
        userEmail: string
        userUsername: string
        userName: string
        userPassword: string
        orgSlug: string
        orgName: string
    }> = {}

    let url = 'http://127.0.0.1:7100'
    let adminEmail = process.env.ADMIN_USER_LOGIN || 'admin@tinycld.org'
    let adminPassword = process.env.ADMIN_USER_PW || 'AdminPass1234!'

    if (args.includes('--help')) process.exit(0)

    for (let i = 0; i < args.length; i++) {
        const arg = args[i]
        switch (arg) {
            case '--mode': {
                const next = args[++i]
                if (next !== 'test' && next !== 'demo') {
                    logError(`Invalid --mode: ${next} (expected: test|demo)`)
                    process.exit(1)
                }
                mode = next
                break
            }
            case '--user-email':
                overrides.userEmail = args[++i]
                break
            case '--user-username':
                overrides.userUsername = args[++i]
                break
            case '--user-name':
                overrides.userName = args[++i]
                break
            case '--user-pw':
                overrides.userPassword = args[++i]
                break
            case '--org-slug':
                overrides.orgSlug = args[++i]
                break
            case '--org-name':
                overrides.orgName = args[++i]
                break
            case '--url':
                url = args[++i]
                break
            case '--admin-email':
                adminEmail = args[++i]
                break
            case '--admin-pw':
                adminPassword = args[++i]
                break
            default:
                if (arg.startsWith('-')) {
                    logError(`Unknown flag: ${arg}`)
                    process.exit(1)
                }
        }
    }

    const defaults = mode === 'demo' ? DEMO_DEFAULTS : TEST_DEFAULTS
    return {
        url,
        adminEmail,
        adminPassword,
        mode,
        userEmail: overrides.userEmail ?? defaults.userEmail,
        userUsername: overrides.userUsername ?? defaults.userUsername,
        userName: overrides.userName ?? defaults.userName,
        userPassword:
            overrides.userPassword ??
            (mode === 'test'
                ? TEST_DEFAULTS.userPassword
                : (process.env.REVIEW_DEMO_PASSWORD ?? '')),
        isDemo: mode === 'demo',
        orgSlug: overrides.orgSlug ?? defaults.orgSlug,
        orgName: overrides.orgName ?? defaults.orgName,
        seedSecondOrg: mode === 'test' && !overrides.orgSlug,
    }
}

function htmlBlob(html: string) {
    return new File([html], 'body.html', { type: 'text/html' })
}

// PocketBase's `getFirstListItem` rejects with a 404 ClientResponseError when
// no record matches. We need to distinguish that from genuine errors (auth
// failures, server-side guards, network issues) so we don't accidentally
// fall through to a `create` that masks the real cause.
function isNotFoundError(err: unknown): boolean {
    if (err && typeof err === 'object' && 'status' in err) {
        return (err as { status: number }).status === 404
    }
    return false
}

function todayAt(dayOffset: number, hour: number, minute = 0) {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() + dayOffset)
    d.setHours(hour, minute, 0, 0)
    return d.toISOString()
}

interface OrgSeedContext {
    user: { id: string; email: string; name: string }
    org: { id: string }
    userOrg: { id: string }
}

const collectionCache = new Map<string, boolean>()
async function hasCollection(pb: PocketBase, name: string): Promise<boolean> {
    const cached = collectionCache.get(name)
    if (cached !== undefined) return cached
    try {
        await pb.collections.getOne(name)
        collectionCache.set(name, true)
        return true
    } catch {
        collectionCache.set(name, false)
        return false
    }
}

async function seedSecondOrg(pb: PocketBase, ctx: OrgSeedContext) {
    log('Seeding second org (light):', SECOND_ORG_SLUG)

    if (await hasCollection(pb, 'contacts')) {
        const contacts = [
            {
                first_name: 'Lena',
                last_name: 'Ortiz',
                email: 'lena@acmecorp.com',
                company: 'Acme Corp',
                job_title: 'CEO',
            },
            {
                first_name: 'Raj',
                last_name: 'Patel',
                email: 'raj@acmecorp.com',
                company: 'Acme Corp',
                job_title: 'CTO',
            },
            {
                first_name: 'Sophie',
                last_name: 'Liu',
                email: 'sophie@vendor.io',
                company: 'Vendor Inc',
                job_title: 'Account Manager',
            },
        ]
        for (const c of contacts) {
            await pb.collection('contacts').create({ ...c, owner: ctx.userOrg.id })
        }
        log('  Created 3 contacts')
    } else {
        log('  skipped contacts (not linked)')
    }

    if (!(await hasCollection(pb, 'mail_domains'))) {
        log('  skipped mail (not linked)')
    } else {
        let domain: { id: string }
        try {
            domain = await pb
                .collection('mail_domains')
                .getFirstListItem(`org = "${ctx.org.id}" && domain = "acmecorp.com"`)
        } catch {
            domain = await pb.collection('mail_domains').create({
                org: ctx.org.id,
                domain: 'acmecorp.com',
                verified: true,
            })
        }

        let mailbox: { id: string }
        try {
            mailbox = await pb
                .collection('mail_mailboxes')
                .getFirstListItem(`address = "user" && domain = "${domain.id}"`)
        } catch {
            mailbox = await pb.collection('mail_mailboxes').create({
                address: 'user',
                domain: domain.id,
                display_name: ctx.user.name,
                type: 'personal',
            })
            await pb.collection('mail_mailbox_members').create({
                mailbox: mailbox.id,
                user_org: ctx.userOrg.id,
                role: 'owner',
            })
        }

        const threads = [
            {
                subject: 'Welcome to Acme Corp',
                snippet: 'Hi! Welcome aboard. Here are some resources to get you started.',
                latest_date: '2026-04-10 09:00:00.000Z',
                folder: 'inbox',
                is_read: true,
                is_starred: false,
                messages: [
                    {
                        sender_name: 'Lena Ortiz',
                        sender_email: 'lena@acmecorp.com',
                        recipients_to: [{ name: ctx.user.name, email: 'user@acmecorp.com' }],
                        date: '2026-04-10 09:00:00.000Z',
                        subject: 'Welcome to Acme Corp',
                        snippet: 'Hi! Welcome aboard.',
                        body_html:
                            '<p>Hi!</p><p>Welcome aboard. Here are some resources to get you started with the team.</p><p>Best,<br/>Lena</p>',
                    },
                ],
            },
            {
                subject: 'Q3 vendor contract review',
                snippet: 'Please review the attached vendor contract before end of week.',
                latest_date: '2026-04-11 14:30:00.000Z',
                folder: 'inbox',
                is_read: false,
                is_starred: true,
                messages: [
                    {
                        sender_name: 'Sophie Liu',
                        sender_email: 'sophie@vendor.io',
                        recipients_to: [{ name: ctx.user.name, email: 'user@acmecorp.com' }],
                        date: '2026-04-11 14:30:00.000Z',
                        subject: 'Q3 vendor contract review',
                        snippet: 'Please review the attached vendor contract.',
                        body_html:
                            '<p>Hi,</p><p>Please review the attached vendor contract before end of week. Let me know if you have questions.</p><p>Thanks,<br/>Sophie</p>',
                    },
                ],
            },
        ]

        for (const thread of threads) {
            const threadRecord = await pb.collection('mail_threads').create({
                mailbox: mailbox.id,
                subject: thread.subject,
                snippet: thread.snippet,
                message_count: thread.messages.length,
                latest_date: thread.latest_date,
                participants: thread.messages.map(m => ({
                    name: m.sender_name,
                    email: m.sender_email,
                })),
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
                formData.append('has_attachments', 'false')
                formData.append('body_html', htmlBlob(msg.body_html))
                formData.append(
                    'message_id',
                    `<acme-${thread.subject.replace(/\s/g, '-').slice(0, 20)}-${i}@acmecorp.com>`
                )
                await pb.collection('mail_messages').create(formData)
            }

            await pb.collection('mail_thread_state').create({
                thread: threadRecord.id,
                user_org: ctx.userOrg.id,
                folder: thread.folder,
                is_read: thread.is_read,
                is_starred: thread.is_starred,
            })
        }
        log('  Created 2 mail threads')
    }

    if (!(await hasCollection(pb, 'calendar_calendars'))) {
        log('  skipped calendar (not linked)')
    } else {
        const calendar = await pb.collection('calendar_calendars').create({
            org: ctx.org.id,
            name: 'Acme Calendar',
            description: 'Main calendar',
            color: 'purple',
        })
        await pb.collection('calendar_members').create({
            calendar: calendar.id,
            user_org: ctx.userOrg.id,
            role: 'owner',
        })

        const events = [
            {
                title: 'Acme weekly standup',
                start: todayAt(1, 10, 0),
                end: todayAt(1, 10, 30),
                description: 'Weekly team sync',
            },
            {
                title: 'Q3 planning kickoff',
                start: todayAt(3, 14, 0),
                end: todayAt(3, 15, 30),
                description: 'Review priorities for next quarter',
            },
        ]
        for (const event of events) {
            await pb.collection('calendar_events').create({
                calendar: calendar.id,
                title: event.title,
                start: event.start,
                end: event.end,
                description: event.description,
                created_by: ctx.userOrg.id,
                busy_status: 'busy',
                visibility: 'default',
            })
        }
        log('  Created 1 calendar with 2 events')
    }

    if (!(await hasCollection(pb, 'drive_items'))) {
        log('  skipped drive (not linked)')
    } else {
        const folder = await pb.collection('drive_items').create({
            org: ctx.org.id,
            name: 'Shared Documents',
            type: 'folder',
            created_by: ctx.userOrg.id,
        })

        const textContent = new File(
            ['# Acme Corp\n\nWelcome to the shared drive. Add files and folders here.'],
            'welcome.md',
            { type: 'text/markdown' }
        )
        const fileForm = new FormData()
        fileForm.append('org', ctx.org.id)
        fileForm.append('name', 'welcome.md')
        fileForm.append('type', 'file')
        fileForm.append('parent', folder.id)
        fileForm.append('created_by', ctx.userOrg.id)
        fileForm.append('mime_type', 'text/markdown')
        fileForm.append('size', String(textContent.size))
        fileForm.append('file', textContent)
        await pb.collection('drive_items').create(fileForm)
        log('  Created 1 folder with 1 file')
    }

    log('Second org seeding complete')
}

/**
 * Find-or-create the target user, primary org, and user_org membership, then
 * run all linked package seeds against them. Optionally seeds a second "Acme"
 * org with light data when `config.seedSecondOrg` is true.
 *
 * Exported so reset-demo.ts can re-seed without shelling out.
 */
export async function seedForUser(pb: PocketBase, config: SeedConfig) {
    // Find first; only branch into create when the lookup specifically returns
    // nothing. Catching around the update too would mask a real failure (e.g.
    // a server-side guard rejecting the write) and silently fall through to a
    // duplicate-create attempt, which then fails with a confusing
    // "username must be unique" error instead of the underlying cause.
    let existingUser: { id: string } | null = null
    try {
        existingUser = await pb
            .collection('users')
            .getFirstListItem(`username = "${config.userUsername}"`)
    } catch (err) {
        if (!isNotFoundError(err)) throw err
    }

    let user: { id: string }
    if (existingUser) {
        user = existingUser
        log('Found existing user:', config.userUsername)
        if (config.isDemo) {
            // The singleton demo account is shared across all anonymous
            // visitors. Any field a previous visitor edited (name via direct
            // update, email/password via the confirmation endpoints) would
            // otherwise persist forever. Force-reset every visitor-mutable
            // field on each reset so the next session starts clean.
            //
            // Password: when REVIEW_DEMO_PASSWORD is set (or --user-pw was
            // passed) we set that stable password so App Review can sign in
            // directly. Otherwise reroll to a random value — the normal
            // /api/demo/start token flow doesn't need a known password.
            const newPassword =
                config.userPassword ||
                `Demo${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}!`
            await pb.collection('users').update(user.id, {
                is_demo: true,
                email: config.userEmail,
                name: config.userName,
                password: newPassword,
                passwordConfirm: newPassword,
            })
        }
    } else {
        log('Creating user:', config.userUsername)
        // Auth collections require *some* password. In demo mode the user
        // normally signs in via /api/demo/start tokens, not credentials, so
        // a random password is fine — but if REVIEW_DEMO_PASSWORD was set
        // (or --user-pw was passed), config.userPassword is non-empty and we
        // use that so App Review can sign in directly.
        const password =
            config.userPassword ||
            `Demo${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}!`
        user = await pb.collection('users').create({
            username: config.userUsername,
            email: config.userEmail,
            password,
            passwordConfirm: password,
            name: config.userName,
            emailVisibility: true,
            verified: true,
            ...(config.isDemo ? { is_demo: true } : {}),
        })
    }

    let org: { id: string }
    try {
        org = await pb.collection('orgs').getFirstListItem(`slug = "${config.orgSlug}"`)
        log('Found existing org:', config.orgSlug)
    } catch {
        log('Creating org:', config.orgSlug)
        org = await pb.collection('orgs').create({
            name: config.orgName,
            slug: config.orgSlug,
        })
    }

    // Same find-then-create split as the user block above — keeps a failed
    // role update from silently falling through to a duplicate-create attempt.
    let existingUserOrg: { id: string; role: string } | null = null
    try {
        existingUserOrg = await pb
            .collection('user_org')
            .getFirstListItem(`user = "${user.id}" && org = "${org.id}"`)
    } catch (err) {
        if (!isNotFoundError(err)) throw err
    }

    let userOrg: { id: string; role: string }
    if (existingUserOrg) {
        if (existingUserOrg.role !== 'owner') {
            log(`Updating user role from "${existingUserOrg.role}" to "owner"`)
            userOrg = await pb.collection('user_org').update(existingUserOrg.id, { role: 'owner' })
        } else {
            log('Found existing user_org membership (role: owner)')
            userOrg = existingUserOrg
        }
    } else {
        log('Creating user_org membership (role: owner)')
        userOrg = await pb.collection('user_org').create({
            org: org.id,
            user: user.id,
            role: 'owner',
        })
    }

    const seedContext = {
        user: { id: user.id, email: config.userEmail, name: config.userName },
        org,
        userOrg,
    }
    const orderedSeeds = deriveSeeds(tinycldSeeds)
    log(`Running ${orderedSeeds.length} package seed(s)...`)
    for (const { slug, seed: seedFn } of orderedSeeds) {
        log(`  → ${slug}`)
        await seedFn(pb, seedContext)
        log(`  ✓ ${slug} done`)
    }

    if (config.seedSecondOrg) {
        let org2: { id: string }
        try {
            org2 = await pb.collection('orgs').getFirstListItem(`slug = "${SECOND_ORG_SLUG}"`)
            log('Found existing org:', SECOND_ORG_SLUG)
        } catch {
            log('Creating org:', SECOND_ORG_SLUG)
            org2 = await pb.collection('orgs').create({
                name: SECOND_ORG_NAME,
                slug: SECOND_ORG_SLUG,
            })
        }

        let userOrg2: { id: string }
        try {
            userOrg2 = await pb
                .collection('user_org')
                .getFirstListItem(`user = "${user.id}" && org = "${org2.id}"`)
            log('Found existing user_org for', SECOND_ORG_SLUG)
        } catch {
            log('Creating user_org membership for', SECOND_ORG_SLUG)
            userOrg2 = await pb.collection('user_org').create({
                org: org2.id,
                user: user.id,
                role: 'owner',
            })
        }

        await seedSecondOrg(pb, {
            user: { id: user.id, email: config.userEmail, name: config.userName },
            org: org2,
            userOrg: userOrg2,
        })
    }
}

export async function authSuperuser(config: {
    url: string
    adminEmail: string
    adminPassword: string
}): Promise<PocketBase> {
    log('Connecting to PocketBase at', config.url)
    const pb = new PocketBase(config.url)
    log('Authenticating as superuser...')
    await pb.collection('_superusers').authWithPassword(config.adminEmail, config.adminPassword)
    return pb
}

async function main() {
    const config = parseArgs()
    log(`Mode: ${config.mode} (user=${config.userEmail}, org=${config.orgSlug})`)
    const pb = await authSuperuser(config)
    await seedForUser(pb, config)
    log('Seeding complete!')
    process.exit(0)
}

if (process.argv[1]?.endsWith('seed-db.ts')) {
    main().catch(err => {
        logError('Failed:', err)
        if (err?.response) {
            logError('Response:', JSON.stringify(err.response, null, 2))
        }
        process.exit(1)
    })
}
