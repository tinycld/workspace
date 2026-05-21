import { strict as assert } from 'node:assert'
import type { CalendarEvents } from '../types'
import {
    buildRRule,
    describeRRule,
    expandRecurringEvents,
    generateOccurrences,
    getContextualPresets,
    parseEventId,
    parseRRule,
} from './recurrence'

function makeEvent(id: string, start: string, end: string, recurrence = ''): CalendarEvents {
    return {
        id,
        calendar: 'cal1',
        created_by: 'user1',
        title: `Event ${id}`,
        description: '',
        location: '',
        start,
        end,
        all_day: false,
        recurrence,
        recurrence_until: '',
        guests: [],
        reminder: 30,
        busy_status: 'busy',
        visibility: 'default',
        ical_uid: '',
        created: '',
        updated: '',
    }
}

function makeAllDayEvent(id: string, start: string, end: string, recurrence = ''): CalendarEvents {
    return { ...makeEvent(id, start, end, recurrence), all_day: true }
}

// --- parseRRule ---

console.log('parseRRule: full RRULE string')
{
    const r = parseRRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR')
    assert.ok(r)
    assert.equal(r.freq, 'WEEKLY')
    assert.equal(r.interval, 2)
    assert.deepEqual(r.byDay, ['MO', 'WE', 'FR'])
}

console.log('parseRRule: RRULE: prefix')
{
    const r = parseRRule('RRULE:FREQ=DAILY;COUNT=5')
    assert.ok(r)
    assert.equal(r.freq, 'DAILY')
    assert.equal(r.count, 5)
}

console.log('parseRRule: legacy tokens')
assert.equal(parseRRule('daily')?.freq, 'DAILY')
assert.equal(parseRRule('weekly')?.freq, 'WEEKLY')
assert.equal(parseRRule('monthly')?.freq, 'MONTHLY')
assert.equal(parseRRule('yearly')?.freq, 'YEARLY')

console.log('parseRRule: empty string')
assert.equal(parseRRule(''), null)

console.log('parseRRule: UNTIL')
{
    const r = parseRRule('FREQ=DAILY;UNTIL=20260706T000000Z')
    assert.ok(r)
    assert.ok(r.until)
    assert.equal(r.until.getFullYear(), 2026)
    assert.equal(r.until.getMonth(), 6) // July
    assert.equal(r.until.getDate(), 6)
}

console.log('parseRRule: BYMONTHDAY')
{
    const r = parseRRule('FREQ=MONTHLY;BYMONTHDAY=15')
    assert.ok(r)
    assert.deepEqual(r.byMonthDay, [15])
}

// --- generateOccurrences: DAILY ---

console.log('daily: occurrence on each day in range')
{
    const start = new Date(2026, 3, 1, 10, 0) // April 1
    const rule = parseRRule('FREQ=DAILY')!
    const rangeStart = new Date(2026, 3, 1)
    const rangeEnd = new Date(2026, 3, 5, 23, 59)
    const occs = generateOccurrences(start, rule, rangeStart, rangeEnd)
    assert.equal(occs.length, 5)
    assert.equal(occs[0].getDate(), 1)
    assert.equal(occs[4].getDate(), 5)
}

console.log('daily: INTERVAL=2')
{
    const start = new Date(2026, 3, 1, 10, 0)
    const rule = parseRRule('FREQ=DAILY;INTERVAL=2')!
    const rangeStart = new Date(2026, 3, 1)
    const rangeEnd = new Date(2026, 3, 10, 23, 59)
    const occs = generateOccurrences(start, rule, rangeStart, rangeEnd)
    assert.equal(occs.length, 5) // 1, 3, 5, 7, 9
    assert.equal(occs[0].getDate(), 1)
    assert.equal(occs[1].getDate(), 3)
    assert.equal(occs[2].getDate(), 5)
}

// --- every weekday ---

console.log('daily + BYDAY: every weekday (Mon-Fri)')
{
    const start = new Date(2026, 3, 6, 9, 0) // Monday April 6
    const rule = parseRRule('FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR')!
    const rangeStart = new Date(2026, 3, 6)
    const rangeEnd = new Date(2026, 3, 12, 23, 59) // through Sunday
    const occs = generateOccurrences(start, rule, rangeStart, rangeEnd)
    assert.equal(occs.length, 5) // Mon-Fri only
    for (const o of occs) {
        assert.ok(o.getDay() >= 1 && o.getDay() <= 5, `Day ${o.getDay()} should be weekday`)
    }
}

// --- generateOccurrences: WEEKLY ---

console.log('weekly: same day of week as event start')
{
    const start = new Date(2026, 3, 1, 10, 0) // Wednesday
    const rule = parseRRule('FREQ=WEEKLY')!
    const rangeStart = new Date(2026, 3, 1)
    const rangeEnd = new Date(2026, 3, 30, 23, 59)
    const occs = generateOccurrences(start, rule, rangeStart, rangeEnd)
    for (const o of occs) {
        assert.equal(o.getDay(), 3) // Wednesday
    }
}

console.log('weekly + BYDAY: only matching days')
{
    const start = new Date(2026, 3, 6, 10, 0) // Monday
    const rule = parseRRule('FREQ=WEEKLY;BYDAY=MO,WE,FR')!
    const rangeStart = new Date(2026, 3, 6)
    const rangeEnd = new Date(2026, 3, 19, 23, 59) // two weeks
    const occs = generateOccurrences(start, rule, rangeStart, rangeEnd)
    assert.equal(occs.length, 6) // 3 per week * 2 weeks
    for (const o of occs) {
        assert.ok([1, 3, 5].includes(o.getDay()))
    }
}

console.log('weekly + INTERVAL=2: every other week')
{
    const start = new Date(2026, 3, 6, 10, 0) // Monday
    const rule = parseRRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO')!
    const rangeStart = new Date(2026, 3, 6)
    const rangeEnd = new Date(2026, 4, 18, 23, 59) // ~6 weeks
    const occs = generateOccurrences(start, rule, rangeStart, rangeEnd)
    assert.equal(occs.length, 4) // every other Monday: Apr 6, 20, May 4, 18
    assert.equal(occs[0].getDate(), 6)
    assert.equal(occs[1].getDate(), 20)
}

// --- generateOccurrences: MONTHLY ---

console.log('monthly: by day of month (default)')
{
    const start = new Date(2026, 0, 15, 10, 0) // Jan 15
    const rule = parseRRule('FREQ=MONTHLY')!
    const rangeStart = new Date(2026, 0, 1)
    const rangeEnd = new Date(2026, 5, 30, 23, 59)
    const occs = generateOccurrences(start, rule, rangeStart, rangeEnd)
    assert.equal(occs.length, 6) // Jan-Jun
    for (const o of occs) {
        assert.equal(o.getDate(), 15)
    }
}

console.log('monthly: BYMONTHDAY=15')
{
    const start = new Date(2026, 0, 15, 10, 0)
    const rule = parseRRule('FREQ=MONTHLY;BYMONTHDAY=15')!
    const rangeStart = new Date(2026, 0, 1)
    const rangeEnd = new Date(2026, 2, 31, 23, 59) // through March
    const occs = generateOccurrences(start, rule, rangeStart, rangeEnd)
    assert.equal(occs.length, 3)
    for (const o of occs) {
        assert.equal(o.getDate(), 15)
    }
}

console.log('monthly on 31st: skips months without 31 days')
{
    const start = new Date(2026, 0, 31, 10, 0) // Jan 31
    const rule = parseRRule('FREQ=MONTHLY')!
    const rangeStart = new Date(2026, 0, 1)
    const rangeEnd = new Date(2026, 11, 31, 23, 59)
    const occs = generateOccurrences(start, rule, rangeStart, rangeEnd)
    // Months with 31 days: Jan, Mar, May, Jul, Aug, Oct, Dec = 7
    assert.equal(occs.length, 7)
    for (const o of occs) {
        assert.equal(o.getDate(), 31)
    }
}

console.log('monthly by weekday position: BYDAY=1MO (first Monday)')
{
    const start = new Date(2026, 0, 5, 10, 0) // First Monday of Jan
    const rule = parseRRule('FREQ=MONTHLY;BYDAY=1MO')!
    const rangeStart = new Date(2026, 0, 1)
    const rangeEnd = new Date(2026, 5, 30, 23, 59) // Jan-Jun
    const occs = generateOccurrences(start, rule, rangeStart, rangeEnd)
    assert.equal(occs.length, 6)
    for (const o of occs) {
        assert.equal(o.getDay(), 1) // Monday
        assert.ok(o.getDate() <= 7, 'First Monday should be day 1-7')
    }
}

console.log('monthly by weekday position: BYDAY=2TU (second Tuesday)')
{
    const start = new Date(2026, 0, 13, 10, 0) // Second Tuesday of Jan
    const rule = parseRRule('FREQ=MONTHLY;BYDAY=2TU')!
    const rangeStart = new Date(2026, 0, 1)
    const rangeEnd = new Date(2026, 2, 31, 23, 59)
    const occs = generateOccurrences(start, rule, rangeStart, rangeEnd)
    assert.equal(occs.length, 3)
    for (const o of occs) {
        assert.equal(o.getDay(), 2) // Tuesday
        assert.ok(o.getDate() >= 8 && o.getDate() <= 14, 'Second Tuesday should be day 8-14')
    }
}

// --- generateOccurrences: YEARLY ---

console.log('yearly: one per year')
{
    const start = new Date(2026, 5, 15, 10, 0) // June 15
    const rule = parseRRule('FREQ=YEARLY')!
    const rangeStart = new Date(2026, 0, 1)
    const rangeEnd = new Date(2030, 11, 31, 23, 59)
    const occs = generateOccurrences(start, rule, rangeStart, rangeEnd)
    assert.equal(occs.length, 5) // 2026-2030
    for (const o of occs) {
        assert.equal(o.getMonth(), 5)
        assert.equal(o.getDate(), 15)
    }
}

// --- COUNT & UNTIL ---

console.log('COUNT: stops at N')
{
    const start = new Date(2026, 3, 1, 10, 0)
    const rule = parseRRule('FREQ=DAILY;COUNT=5')!
    const rangeStart = new Date(2026, 3, 1)
    const rangeEnd = new Date(2026, 3, 30, 23, 59)
    const occs = generateOccurrences(start, rule, rangeStart, rangeEnd)
    assert.equal(occs.length, 5)
}

console.log('UNTIL: stops at date')
{
    const start = new Date(2026, 3, 1, 10, 0)
    const rule = parseRRule('FREQ=DAILY;UNTIL=20260405T235959Z')!
    const rangeStart = new Date(2026, 3, 1)
    const rangeEnd = new Date(2026, 3, 30, 23, 59)
    const occs = generateOccurrences(start, rule, rangeStart, rangeEnd)
    assert.equal(occs.length, 5) // Apr 1-5
}

// --- Range edge cases ---

console.log('event start before range: forward occurrences still emitted')
{
    const start = new Date(2026, 0, 1, 10, 0) // Jan 1
    const rule = parseRRule('FREQ=WEEKLY')!
    const rangeStart = new Date(2026, 3, 1)
    const rangeEnd = new Date(2026, 3, 30, 23, 59)
    const occs = generateOccurrences(start, rule, rangeStart, rangeEnd)
    assert.ok(occs.length > 0)
    for (const o of occs) {
        assert.ok(o >= rangeStart)
        assert.ok(o <= rangeEnd)
    }
}

console.log('event after range: no occurrences')
{
    const start = new Date(2027, 0, 1, 10, 0) // Future
    const rule = parseRRule('FREQ=DAILY')!
    const rangeStart = new Date(2026, 3, 1)
    const rangeEnd = new Date(2026, 3, 30, 23, 59)
    const occs = generateOccurrences(start, rule, rangeStart, rangeEnd)
    assert.equal(occs.length, 0)
}

// --- expandRecurringEvents ---

console.log('expandRecurringEvents: non-recurring pass through')
{
    const event = makeEvent('e1', '2026-04-05T10:00:00Z', '2026-04-05T11:00:00Z')
    const result = expandRecurringEvents({
        events: [event],
        rangeStart: new Date(2026, 3, 1),
        rangeEnd: new Date(2026, 3, 30, 23, 59),
    })
    assert.equal(result.length, 1)
    assert.equal(result[0].id, 'e1')
}

console.log('expandRecurringEvents: non-recurring outside range excluded')
{
    const event = makeEvent('e1', '2026-01-05T10:00:00Z', '2026-01-05T11:00:00Z')
    const result = expandRecurringEvents({
        events: [event],
        rangeStart: new Date(2026, 3, 1),
        rangeEnd: new Date(2026, 3, 30, 23, 59),
    })
    assert.equal(result.length, 0)
}

console.log('expandRecurringEvents: daily recurrence creates multiple occurrences')
{
    const event = makeEvent('e1', '2026-04-01T10:00:00.000Z', '2026-04-01T11:00:00.000Z', 'FREQ=DAILY')
    const result = expandRecurringEvents({
        events: [event],
        rangeStart: new Date(2026, 3, 1),
        rangeEnd: new Date(2026, 3, 3, 23, 59),
    })
    assert.equal(result.length, 3)
    assert.ok(result[0].id.startsWith('e1____'))
    assert.ok(result[1].id.startsWith('e1____'))
    assert.ok(result[2].id.startsWith('e1____'))
}

console.log('expandRecurringEvents: all-day recurring events')
{
    const event = makeAllDayEvent('e1', '2026-04-06T00:00:00.000Z', '2026-04-06T23:59:59.000Z', 'FREQ=WEEKLY;BYDAY=MO')
    const result = expandRecurringEvents({
        events: [event],
        rangeStart: new Date(2026, 3, 1),
        rangeEnd: new Date(2026, 3, 30, 23, 59),
    })
    // Mondays in April 2026: 6, 13, 20, 27
    assert.equal(result.length, 4)
    for (const r of result) {
        assert.equal(r.all_day, true)
    }
}

console.log('expandRecurringEvents: safety cap')
{
    const event = makeEvent('e1', '2026-04-01T10:00:00.000Z', '2026-04-01T11:00:00.000Z', 'FREQ=DAILY')
    const result = expandRecurringEvents({
        events: [event],
        rangeStart: new Date(2026, 3, 1),
        rangeEnd: new Date(2030, 11, 31, 23, 59),
        maxOccurrences: 10,
    })
    assert.equal(result.length, 10)
}

// --- Composite IDs ---

console.log('composite IDs: unique and parseable')
{
    const event = makeEvent('abc123', '2026-04-01T10:00:00.000Z', '2026-04-01T11:00:00.000Z', 'FREQ=DAILY')
    const result = expandRecurringEvents({
        events: [event],
        rangeStart: new Date(2026, 3, 1),
        rangeEnd: new Date(2026, 3, 3, 23, 59),
    })
    const ids = result.map((r) => r.id)
    assert.equal(new Set(ids).size, ids.length, 'IDs should be unique')

    const parsed = parseEventId(ids[0])
    assert.equal(parsed.baseId, 'abc123')
    assert.ok(parsed.occurrenceDate)
}

console.log('parseEventId: non-composite ID')
{
    const parsed = parseEventId('simple-id')
    assert.equal(parsed.baseId, 'simple-id')
    assert.equal(parsed.occurrenceDate, undefined)
}

// --- buildRRule ---

console.log('buildRRule: simple daily')
{
    const rrule = buildRRule({ freq: 'DAILY' })
    assert.equal(rrule, 'FREQ=DAILY')
}

console.log('buildRRule: weekly with BYDAY and INTERVAL')
{
    const rrule = buildRRule({ freq: 'WEEKLY', interval: 2, byDay: ['MO', 'WE', 'FR'] })
    assert.equal(rrule, 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR')
}

console.log('buildRRule: monthly with BYMONTHDAY')
{
    const rrule = buildRRule({ freq: 'MONTHLY', byMonthDay: [15] })
    assert.equal(rrule, 'FREQ=MONTHLY;BYMONTHDAY=15')
}

console.log('buildRRule: with COUNT')
{
    const rrule = buildRRule({ freq: 'DAILY', count: 10 })
    assert.equal(rrule, 'FREQ=DAILY;COUNT=10')
}

console.log('buildRRule: with UNTIL')
{
    const rrule = buildRRule({ freq: 'DAILY', until: new Date(2026, 6, 6) })
    assert.ok(rrule.includes('UNTIL=20260706T235959Z'))
}

// --- describeRRule ---

console.log('describeRRule: daily')
{
    const desc = describeRRule('FREQ=DAILY', new Date(2026, 3, 5))
    assert.equal(desc, 'Daily')
}

console.log('describeRRule: every weekday')
{
    const desc = describeRRule('FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR', new Date(2026, 3, 5))
    assert.equal(desc, 'Every weekday (Monday to Friday)')
}

console.log('describeRRule: weekly on Monday')
{
    const desc = describeRRule('FREQ=WEEKLY;BYDAY=MO', new Date(2026, 3, 6))
    assert.equal(desc, 'Weekly on Monday')
}

console.log('describeRRule: monthly first Monday')
{
    const desc = describeRRule('FREQ=MONTHLY;BYDAY=1MO', new Date(2026, 3, 6))
    assert.equal(desc, 'Monthly on the first Monday')
}

console.log('describeRRule: yearly')
{
    const desc = describeRRule('FREQ=YEARLY', new Date(2026, 3, 5))
    assert.equal(desc, 'Annually on April 5')
}

console.log('describeRRule: with COUNT')
{
    const desc = describeRRule('FREQ=DAILY;COUNT=10', new Date(2026, 3, 5))
    assert.equal(desc, 'Daily, 10 times')
}

console.log('describeRRule: every 2 weeks')
{
    const desc = describeRRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR', new Date(2026, 3, 6))
    assert.equal(desc, 'Every 2 weeks on Monday, Friday')
}

console.log('describeRRule: empty string')
{
    const desc = describeRRule('', new Date(2026, 3, 5))
    assert.equal(desc, '')
}

// --- getContextualPresets ---

console.log('getContextualPresets: generates correct presets for a Monday')
{
    const presets = getContextualPresets(new Date(2026, 3, 6)) // Monday April 6
    assert.equal(presets.length, 7)
    assert.equal(presets[0].value, '')
    assert.equal(presets[1].value, 'FREQ=DAILY')
    assert.ok(presets[2].value.includes('BYDAY=MO'))
    assert.ok(presets[3].value.includes('BYDAY=1MO'))
    assert.equal(presets[6].value, '__custom__')
}

console.log('All recurrence tests passed!')
