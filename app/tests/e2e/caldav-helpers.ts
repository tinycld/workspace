import ICAL from 'ical.js'
import { TEST_USER_EMAIL, TEST_USER_PASSWORD } from './helpers'

// Tests now go through the dev.ts proxy on TEST_EXPO_PORT (see
// playwright.config.ts), which fans /caldav to the same PB instance the
// app is talking to. Same-origin via the proxy keeps cookies/auth aligned
// with the browser context.
const CALDAV_BASE = 'http://127.0.0.1:7200/caldav'

export interface CalDAVCalendar {
    id: string
    name: string
    path: string
}

export interface CalDAVEventRef {
    href: string
    uid: string
    etag: string
}

export interface PutEventProps {
    summary: string
    start: Date
    end: Date
    description?: string
}

function authHeader(user = TEST_USER_EMAIL, pass = TEST_USER_PASSWORD): string {
    return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`
}

async function caldavFetch(
    method: string,
    path: string,
    init: { body?: string; contentType?: string; depth?: string; auth?: string } = {}
): Promise<Response> {
    const headers: Record<string, string> = {
        Authorization: init.auth ?? authHeader(),
    }
    if (init.depth !== undefined) headers.Depth = init.depth
    if (init.contentType) headers['Content-Type'] = init.contentType

    return fetch(`${CALDAV_BASE}${path}`, {
        method,
        headers,
        body: init.body,
    })
}

const PROPFIND_CALENDAR_BODY = `<?xml version="1.0" encoding="utf-8" ?>
<propfind xmlns="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
    <prop>
        <displayname/>
        <resourcetype/>
        <c:supported-calendar-component-set/>
    </prop>
</propfind>`

const PROPFIND_EVENT_BODY = `<?xml version="1.0" encoding="utf-8" ?>
<propfind xmlns="DAV:">
    <prop>
        <getetag/>
    </prop>
</propfind>`

/**
 * Lightweight multistatus parser. The go-webdav response we get back is
 * shallow and well-formed enough that regex over <response> blocks is
 * sufficient — pulling in xmldom or fast-xml-parser for one harness file
 * isn't worth the dependency. If the response shape ever changes, this
 * is the place to swap in a real parser.
 */
function parseMultistatusResponses(
    xml: string
): { href: string; displayname?: string; etag?: string }[] {
    const responses: { href: string; displayname?: string; etag?: string }[] = []
    const responseRe = /<(?:\w+:)?response\b[^>]*>([\s\S]*?)<\/(?:\w+:)?response>/g
    for (const m of xml.matchAll(responseRe)) {
        const block = m[1]
        const hrefMatch = /<(?:\w+:)?href\b[^>]*>([\s\S]*?)<\/(?:\w+:)?href>/.exec(block)
        if (!hrefMatch) continue
        const href = hrefMatch[1].trim()
        const dnMatch = /<(?:\w+:)?displayname\b[^>]*>([\s\S]*?)<\/(?:\w+:)?displayname>/.exec(
            block
        )
        const etagMatch = /<(?:\w+:)?getetag\b[^>]*>([\s\S]*?)<\/(?:\w+:)?getetag>/.exec(block)
        responses.push({
            href,
            displayname: dnMatch?.[1].trim(),
            etag: etagMatch?.[1].trim().replace(/^"|"$/g, ''),
        })
    }
    return responses
}

export async function propfindCalendars(): Promise<CalDAVCalendar[]> {
    const res = await caldavFetch('PROPFIND', '/u/cal/', {
        depth: '1',
        contentType: 'application/xml; charset=utf-8',
        body: PROPFIND_CALENDAR_BODY,
    })
    if (res.status !== 207) {
        throw new Error(`PROPFIND /u/cal/ expected 207, got ${res.status}: ${await res.text()}`)
    }
    const xml = await res.text()
    const responses = parseMultistatusResponses(xml)

    return responses.flatMap(r => {
        const m = /\/caldav\/u\/cal\/([^/]+)\/?$/.exec(r.href)
        if (!m?.[1]) return []
        return [{ id: m[1], name: r.displayname ?? '', path: r.href }]
    })
}

export async function propfindEvents(calendarId: string): Promise<CalDAVEventRef[]> {
    const res = await caldavFetch('PROPFIND', `/u/cal/${calendarId}/`, {
        depth: '1',
        contentType: 'application/xml; charset=utf-8',
        body: PROPFIND_EVENT_BODY,
    })
    if (res.status !== 207) {
        throw new Error(
            `PROPFIND /u/cal/${calendarId}/ expected 207, got ${res.status}: ${await res.text()}`
        )
    }
    const xml = await res.text()
    const responses = parseMultistatusResponses(xml)

    return responses
        .map(r => {
            const m = /\/caldav\/u\/cal\/[^/]+\/([^/]+)\.ics$/.exec(r.href)
            if (!m) return null
            return { href: r.href, uid: m[1], etag: r.etag ?? '' }
        })
        .filter((x): x is CalDAVEventRef => x !== null)
}

export async function getEvent(calendarId: string, uid: string): Promise<string> {
    const res = await caldavFetch('GET', `/u/cal/${calendarId}/${uid}.ics`)
    if (res.status !== 200) {
        throw new Error(`GET event expected 200, got ${res.status}: ${await res.text()}`)
    }
    return res.text()
}

function buildVCalendar(uid: string, props: PutEventProps): string {
    const vcalendar = new ICAL.Component(['vcalendar', [], []])
    vcalendar.updatePropertyWithValue('prodid', '-//tinycld//caldav-test-harness//EN')
    vcalendar.updatePropertyWithValue('version', '2.0')

    const vevent = new ICAL.Component('vevent')
    vevent.updatePropertyWithValue('uid', uid)
    vevent.updatePropertyWithValue('summary', props.summary)
    vevent.updatePropertyWithValue('dtstart', ICAL.Time.fromJSDate(props.start, true))
    vevent.updatePropertyWithValue('dtend', ICAL.Time.fromJSDate(props.end, true))
    vevent.updatePropertyWithValue('dtstamp', ICAL.Time.fromJSDate(new Date(), true))
    if (props.description) {
        vevent.updatePropertyWithValue('description', props.description)
    }
    vcalendar.addSubcomponent(vevent)
    return vcalendar.toString()
}

export async function putEvent(
    calendarId: string,
    uid: string,
    props: PutEventProps
): Promise<{ status: number; etag?: string }> {
    const body = buildVCalendar(uid, props)
    const res = await caldavFetch('PUT', `/u/cal/${calendarId}/${uid}.ics`, {
        contentType: 'text/calendar; charset=utf-8',
        body,
    })
    if (res.status !== 201 && res.status !== 204) {
        throw new Error(`PUT event expected 201 or 204, got ${res.status}: ${await res.text()}`)
    }
    return {
        status: res.status,
        etag: res.headers.get('etag')?.replace(/^"|"$/g, ''),
    }
}

export async function deleteEvent(calendarId: string, uid: string): Promise<number> {
    const res = await caldavFetch('DELETE', `/u/cal/${calendarId}/${uid}.ics`)
    if (res.status !== 204 && res.status !== 200) {
        throw new Error(`DELETE event expected 204 or 200, got ${res.status}: ${await res.text()}`)
    }
    return res.status
}

/**
 * Parse iCal text and return the first VEVENT's SUMMARY. Used in tests to
 * assert "the event we GET back has the SUMMARY we expect" without
 * depending on the exact iCal serialization format.
 */
export function parseICalSummary(ics: string): string {
    const jcal = ICAL.parse(ics)
    const vcalendar = new ICAL.Component(jcal)
    const vevent = vcalendar.getFirstSubcomponent('vevent')
    if (!vevent) throw new Error(`no VEVENT in iCal:\n${ics}`)
    return vevent.getFirstPropertyValue('summary') as string
}

/**
 * Issue a PROPFIND with a custom (or missing) Authorization header to
 * verify the server's auth gate. Returns the status so tests can assert
 * the 401 path without any of the helpers above throwing on non-207.
 */
export async function rawCaldavRequest(
    method: string,
    path: string,
    auth?: string
): Promise<number> {
    const res = await fetch(`${CALDAV_BASE}${path}`, {
        method,
        headers: auth ? { Authorization: auth } : {},
    })
    return res.status
}
