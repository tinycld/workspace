#!/usr/bin/env -S npx tsx
/**
 * Contacts server API smoke test
 *
 * Authenticates against PocketBase as a regular user and exercises the
 * CardDAV endpoints contributed by the contacts package. Run from core's
 * working directory (so `core/server/tinycld` is already built + the
 * contacts package is linked).
 *
 * Usage:
 *   npx tsx ../contacts/scripts/test-server-api.ts \
 *     --url http://127.0.0.1:7091 \
 *     --email user@tinycld.org \
 *     --password TestUser1234!
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
        url: process.env.SMOKE_TEST_ADDRESS || 'http://127.0.0.1:7090',
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

interface AuthResult {
    token: string
    userId: string
    orgSlug: string
}

async function authenticate(config: Config): Promise<AuthResult | null> {
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
            return null
        }
        ok('POST auth-with-password', `user ${data.record.id}`)

        const userOrgs = data.record?.expand?.user_org_via_user ?? []
        const orgSlug = userOrgs[0]?.expand?.org?.slug
        if (!orgSlug) {
            fail('Auth', 'no org found for user')
            return null
        }
        ok('User org', orgSlug)
        return { token: data.token, userId: data.record.id, orgSlug }
    } catch (err) {
        fail('Auth', String(err))
        return null
    }
}

async function testCardDAV(config: Config, auth: AuthResult) {
    console.log('\n▸ CardDAV')
    const basicAuth = Buffer.from(`${config.email}:${config.password}`).toString('base64')
    const headers = { Authorization: `Basic ${basicAuth}` }
    const addressBookPath = `/carddav/u/ab/${auth.orgSlug}/`

    try {
        const res = await fetch(`${config.url}/.well-known/carddav`, {
            method: 'GET',
            headers,
            redirect: 'manual',
        })
        if (res.status === 301 || res.status === 302 || res.status === 200) {
            ok('GET /.well-known/carddav', `${res.status} → ${res.headers.get('location') || 'ok'}`)
        } else {
            fail('GET /.well-known/carddav', `status ${res.status}`)
        }
    } catch (err) {
        fail('GET /.well-known/carddav', String(err))
    }

    try {
        const body = `<?xml version="1.0" encoding="utf-8"?>
<card:addressbook-query xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">
  <d:prop>
    <d:getetag/>
    <card:address-data/>
  </d:prop>
</card:addressbook-query>`

        const res = await fetch(`${config.url}${addressBookPath}`, {
            method: 'REPORT',
            headers: { ...headers, 'Content-Type': 'application/xml', Depth: '1' },
            body,
        })
        if (res.status === 207) {
            const text = await res.text()
            const contactCount = (text.match(/<[A-Za-z:]*response[^>]*>/g) || []).length
            ok('REPORT address-book-query', `${contactCount} contacts`)
        } else {
            fail('REPORT address-book-query', `status ${res.status}`)
        }
    } catch (err) {
        fail('REPORT address-book-query', String(err))
    }

    const testUID = `test-api-${Date.now()}`
    const vcardPath = `${addressBookPath}${testUID}.vcf`
    try {
        const vcard = [
            'BEGIN:VCARD',
            'VERSION:3.0',
            `UID:${testUID}`,
            'FN:API Test Contact',
            'N:Contact;API Test;;;',
            'EMAIL:apitest@example.com',
            'TEL:555-999-0000',
            'END:VCARD',
        ].join('\r\n')

        const res = await fetch(`${config.url}${vcardPath}`, {
            method: 'PUT',
            headers: { ...headers, 'Content-Type': 'text/vcard' },
            body: vcard,
        })
        if (res.status >= 200 && res.status < 300) {
            ok('PUT contact', `${res.status} created ${testUID}`)
        } else {
            const text = await res.text()
            fail('PUT contact', `status ${res.status}: ${text.slice(0, 200)}`)
        }
    } catch (err) {
        fail('PUT contact', String(err))
    }

    try {
        const res = await fetch(`${config.url}${vcardPath}`, {
            method: 'GET',
            headers,
        })
        if (res.ok) {
            const text = await res.text()
            if (text.includes('API Test Contact')) {
                ok('GET contact', 'vcard content verified')
            } else {
                fail('GET contact', 'vcard content missing expected data')
            }
        } else {
            fail('GET contact', `status ${res.status}`)
        }
    } catch (err) {
        fail('GET contact', String(err))
    }

    try {
        const res = await fetch(`${config.url}${vcardPath}`, {
            method: 'DELETE',
            headers,
        })
        if (res.ok || res.status === 204) {
            ok('DELETE contact', `${res.status}`)
        } else {
            const text = await res.text()
            fail('DELETE contact', `status ${res.status}: ${text.slice(0, 200)}`)
        }
    } catch (err) {
        fail('DELETE contact', String(err))
    }
}

async function main() {
    const config = parseArgs()
    console.log(`\nTesting CardDAV at ${config.url} as ${config.email}`)

    const auth = await authenticate(config)
    if (auth) {
        await testCardDAV(config, auth)
    }

    console.log(`\n${passed} passed, ${failed} failed\n`)
    if (failed > 0) process.exit(1)
}

main()
