#!/usr/bin/env -S npx tsx
/**
 * Demo Reset Script
 *
 * Wipes all data scoped to the singleton demo org and re-seeds it. Designed
 * to run nightly so the demo workspace is always pristine for the next
 * unauthenticated visitor that hits /api/demo/start.
 *
 * The demo *user* (`demo@tinycld.org`, is_demo=true) is preserved across
 * resets — only their org and all org-scoped data is wiped. The seed step
 * recreates the org and user_org membership.
 *
 * Usage:
 *   npx tsx scripts/reset-demo.ts [options]
 *
 * Options:
 *   --url <url>            PocketBase URL (default: http://127.0.0.1:7100)
 *   --admin-email <email>  Superuser email
 *   --admin-pw <pw>        Superuser password
 *   --help                 Show this help message
 */

import type PocketBase from 'pocketbase'
import { authSuperuser, seedForUser } from './seed-db'

function log(...args: unknown[]) {
    process.stdout.write(`[reset-demo] ${args.join(' ')}\n`)
}

function logError(...args: unknown[]) {
    process.stderr.write(`[reset-demo] ${args.join(' ')}\n`)
}

try {
    process.loadEnvFile()
} catch {
    // .env may not exist in CI/Docker
}

// Mirror demo_start.go constants exactly. REVIEW_DEMO_EMAIL overrides the
// email so App Review can sign in directly; if it differs from
// demo@tinycld.org, demo_start.go's demoUserEmail constant must be patched
// too or the demo-token flow won't find the user.
const DEMO_USER_EMAIL = process.env.REVIEW_DEMO_EMAIL || 'demo@tinycld.org'
const DEMO_USER_USERNAME = 'demo'
const DEMO_USER_NAME = 'Demo Tour'
const DEMO_ORG_SLUG = 'demo'
const DEMO_ORG_NAME = 'Demo Workspace'

function parseArgs() {
    const args = process.argv.slice(2)
    if (args.includes('--help')) process.exit(0)

    let url = 'http://127.0.0.1:7100'
    let adminEmail = process.env.ADMIN_USER_LOGIN || 'admin@tinycld.org'
    let adminPassword = process.env.ADMIN_USER_PW || 'AdminPass1234!'

    for (let i = 0; i < args.length; i++) {
        const arg = args[i]
        switch (arg) {
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

    return { url, adminEmail, adminPassword }
}

async function findDemoOrg(pb: PocketBase): Promise<{ id: string } | null> {
    try {
        return await pb.collection('orgs').getFirstListItem(`slug = "${DEMO_ORG_SLUG}"`)
    } catch {
        return null
    }
}

async function main() {
    const config = parseArgs()
    const pb = await authSuperuser(config)

    const demoOrg = await findDemoOrg(pb)
    if (demoOrg) {
        log(`Deleting demo org ${demoOrg.id} (cascades all org-scoped data)`)
        // Every org-scoped collection (mail_domains, calendar_calendars,
        // drive_items, contacts.owner→user_org→org, labels, user_org, ...)
        // declares cascadeDelete: true on its `org` (or via parent chain) FK.
        // Deleting this single record clears the entire workspace.
        await pb.collection('orgs').delete(demoOrg.id)
    } else {
        log('No existing demo org found — nothing to wipe, will create fresh')
    }

    // seedForUser handles the find-or-create dance for user, org, user_org and
    // runs every linked package's seed() against the demo workspace.
    await seedForUser(pb, {
        url: config.url,
        adminEmail: config.adminEmail,
        adminPassword: config.adminPassword,
        mode: 'demo',
        userEmail: DEMO_USER_EMAIL,
        userUsername: DEMO_USER_USERNAME,
        userName: DEMO_USER_NAME,
        // Passing through REVIEW_DEMO_PASSWORD here keeps App Review's demo
        // creds stable across nightly resets. When unset, seedForUser falls
        // back to a random password (the normal /api/demo/start flow doesn't
        // need a known password).
        userPassword: process.env.REVIEW_DEMO_PASSWORD ?? '',
        isDemo: true,
        orgSlug: DEMO_ORG_SLUG,
        orgName: DEMO_ORG_NAME,
        seedSecondOrg: false,
    })

    log('Demo reset complete')
    process.exit(0)
}

main().catch(err => {
    logError('Failed:', err)
    if (err?.response) {
        logError('Response:', JSON.stringify(err.response, null, 2))
    }
    process.exit(1)
})
