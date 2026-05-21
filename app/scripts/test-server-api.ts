#!/usr/bin/env -S npx tsx
/**
 * Core server API smoke test
 *
 * Authenticates against PocketBase and exercises core-owned server APIs.
 * Package-specific smoke tests (e.g. CardDAV for contacts, CalDAV for
 * calendar) live in their own repos so a core-only checkout stays green.
 *
 * Usage:
 *   npx tsx scripts/test-server-api.ts [--email <email>] [--password <pw>] [--url <url>]
 */

try {
    process.loadEnvFile()
} catch {
    // .env may not exist
}

interface Config {
    url: string
    email: string
    password: string
}

function parseArgs(): Config {
    const args = process.argv.slice(2)
    const config: Config = {
        url: process.env.SMOKE_TEST_ADDRESS || 'http://127.0.0.1:7100',
        email: process.env.SMOKE_TEST_USER || '',
        password: process.env.SMOKE_TEST_PW || '',
    }

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--url':
                config.url = args[++i]
                break
            case '--email':
                config.email = args[++i]
                break
            case '--password':
                config.password = args[++i]
                break
            case '--help':
                console.log(
                    'Usage: npx tsx scripts/test-server-api.ts [--email <email>] [--password <pw>] [--url <url>]'
                )
                console.log('  Or set SMOKE_TEST_USER and SMOKE_TEST_PW in .env')
                process.exit(0)
        }
    }

    if (!config.email || !config.password) {
        console.error(
            'Error: credentials required via --email/--password flags or SMOKE_TEST_USER/SMOKE_TEST_PW in .env'
        )
        process.exit(1)
    }

    return config
}

let passed = 0
let failed = 0

function ok(label: string, detail?: string) {
    passed++
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`)
}

function fail(label: string, detail: string) {
    failed++
    console.error(`  ✗ ${label} — ${detail}`)
}

async function testHealth(config: Config) {
    console.log('\n▸ Health check')
    try {
        const res = await fetch(`${config.url}/api/health`)
        if (res.ok) {
            ok('GET /api/health', `${res.status}`)
        } else {
            fail('GET /api/health', `status ${res.status}`)
        }
    } catch (err) {
        fail('GET /api/health', String(err))
    }
}

async function testAuth(config: Config) {
    console.log('\n▸ Authentication')
    try {
        const url = `${config.url}/api/collections/users/auth-with-password?expand=user_org_via_user.org`
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                identity: config.email,
                password: config.password,
            }),
        })
        const data = await res.json()
        if (!res.ok || !data.token) {
            fail('Auth', `status ${res.status}: ${data.message || 'unknown error'}`)
            return
        }
        ok('POST auth-with-password', `user ${data.record.id}`)

        const userOrgs = data.record?.expand?.user_org_via_user ?? []
        const orgSlug = userOrgs[0]?.expand?.org?.slug
        if (!orgSlug) {
            fail('Auth', 'no org found for user')
            return
        }
        ok('User org', orgSlug)
    } catch (err) {
        fail('Auth', String(err))
    }
}

async function main() {
    const config = parseArgs()
    console.log(`\nTesting core server at ${config.url} as ${config.email}`)

    await testHealth(config)
    await testAuth(config)

    console.log(`\n${passed} passed, ${failed} failed\n`)
    if (failed > 0) process.exit(1)
}

main()
