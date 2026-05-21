import ICAL from 'ical.js'
import type { EventGuest, ParsedCalendar, ParsedCalendarEvent } from '../types'

export function parseCalendars(entries: Map<string, Uint8Array>): ParsedCalendar[] {
    const calendars: ParsedCalendar[] = []
    const decoder = new TextDecoder()

    for (const [path, data] of entries) {
        if (!path.includes('Calendar/') || !path.endsWith('.ics')) continue
        const text = decoder.decode(data)
        const cal = parseIcsText(text, path)
        if (cal && cal.events.length > 0) calendars.push(cal)
    }

    return calendars
}

function parseIcsText(text: string, path: string): ParsedCalendar | null {
    let parsed: ReturnType<typeof ICAL.parse>
    try {
        parsed = ICAL.parse(text)
    } catch {
        return null
    }

    const vcalendar = new ICAL.Component(parsed)

    const calendarName =
        (vcalendar.getFirstPropertyValue('x-wr-calname') as string) ||
        path.split('/').pop()?.replace('.ics', '') ||
        'Imported'

    const vevents = vcalendar.getAllSubcomponents('vevent')
    const events: ParsedCalendarEvent[] = []

    for (const vevent of vevents) {
        const event = parseEvent(vevent, calendarName)
        if (event) events.push(event)
    }

    return { recordType: 'calendar', name: calendarName, events }
}

function parseEvent(vevent: ICAL.Component, calendarName: string): ParsedCalendarEvent | null {
    const summary = (vevent.getFirstPropertyValue('summary') as string) || ''
    const description = (vevent.getFirstPropertyValue('description') as string) || ''
    const location = (vevent.getFirstPropertyValue('location') as string) || ''
    const uid = (vevent.getFirstPropertyValue('uid') as string) || ''
    const rruleProp = vevent.getFirstProperty('rrule')
    const recurrence = rruleProp ? rruleProp.getFirstValue()?.toString() || '' : ''

    const dtstart = vevent.getFirstPropertyValue('dtstart') as ICAL.Time | null
    const dtend = vevent.getFirstPropertyValue('dtend') as ICAL.Time | null

    if (!dtstart) return null
    if (!summary && !uid) return null

    const allDay = dtstart.isDate
    const start = dtstart.toJSDate().toISOString()
    const end = dtend ? dtend.toJSDate().toISOString() : start

    // Attendees
    const guests: EventGuest[] = []
    for (const att of vevent.getAllProperties('attendee')) {
        const mailto = (att.getFirstValue() as string) || ''
        const email = mailto.replace(/^mailto:/i, '').trim()
        if (!email) continue

        guests.push({
            name: (att.getParameter('cn') as string) || '',
            email,
            rsvp: ((att.getParameter('partstat') as string) || 'NEEDS-ACTION').toLowerCase(),
        })
    }

    // Alarm / reminder
    let reminder = 0
    const valarms = vevent.getAllSubcomponents('valarm')
    for (const alarm of valarms) {
        const trigger = alarm.getFirstPropertyValue('trigger') as ICAL.Duration | null
        if (trigger?.isNegative) {
            const minutes =
                (trigger.weeks || 0) * 7 * 24 * 60 +
                (trigger.days || 0) * 24 * 60 +
                (trigger.hours || 0) * 60 +
                (trigger.minutes || 0)
            if (minutes > 0) {
                reminder = minutes
                break
            }
        }
    }

    // Busy status
    const transp = (vevent.getFirstPropertyValue('transp') as string) || ''
    const busyStatus: 'busy' | 'free' = transp.toUpperCase() === 'TRANSPARENT' ? 'free' : 'busy'

    // Visibility
    const classVal = (vevent.getFirstPropertyValue('class') as string) || ''
    let visibility: 'default' | 'public' | 'private' = 'default'
    if (classVal.toUpperCase() === 'PRIVATE') visibility = 'private'
    else if (classVal.toUpperCase() === 'PUBLIC') visibility = 'public'

    return {
        recordType: 'calendar_event',
        calendarName,
        title: summary.slice(0, 500),
        description: description.slice(0, 5000),
        location: location.slice(0, 500),
        start,
        end,
        all_day: allDay,
        recurrence: recurrence.slice(0, 500),
        ical_uid: uid.slice(0, 500),
        guests,
        reminder,
        busy_status: busyStatus,
        visibility,
    }
}
