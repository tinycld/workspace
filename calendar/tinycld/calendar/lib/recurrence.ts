import type { CalendarEvents } from '../types'

const DAY_NAMES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const
const DAY_INDEX: Record<string, number> = {
    SU: 0,
    MO: 1,
    TU: 2,
    WE: 3,
    TH: 4,
    FR: 5,
    SA: 6,
}

const FULL_DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const MONTH_NAMES = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
]

type Freq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'

export interface ParsedRRule {
    freq: Freq
    interval: number
    byDay?: string[]
    byMonthDay?: number[]
    count?: number
    until?: Date
}

export interface RRuleOptions {
    freq: Freq
    interval?: number
    byDay?: string[]
    byMonthDay?: number[]
    count?: number
    until?: Date
}

const LEGACY_MAP: Record<string, Freq> = {
    daily: 'DAILY',
    weekly: 'WEEKLY',
    monthly: 'MONTHLY',
    yearly: 'YEARLY',
}

const OCCURRENCE_SEP = '____'

export function parseRRule(rrule: string): ParsedRRule | null {
    if (!rrule) return null

    const legacyFreq = LEGACY_MAP[rrule.toLowerCase()]
    if (legacyFreq) {
        return { freq: legacyFreq, interval: 1 }
    }

    const normalized = rrule.replace(/^RRULE:/i, '')
    const parts = normalized.split(';')
    const map: Record<string, string> = {}
    for (const part of parts) {
        const [key, val] = part.split('=')
        if (key && val) map[key.toUpperCase()] = val
    }

    const freq = map.FREQ as Freq | undefined
    if (!freq || !['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) {
        return null
    }

    const result: ParsedRRule = {
        freq,
        interval: map.INTERVAL ? Number.parseInt(map.INTERVAL, 10) : 1,
    }

    if (map.BYDAY) {
        result.byDay = map.BYDAY.split(',').map((d) => d.trim())
    }

    if (map.BYMONTHDAY) {
        result.byMonthDay = map.BYMONTHDAY.split(',').map((d) => Number.parseInt(d.trim(), 10))
    }

    if (map.COUNT) {
        result.count = Number.parseInt(map.COUNT, 10)
    }

    if (map.UNTIL) {
        result.until = parseUntilDate(map.UNTIL)
    }

    return result
}

function parseUntilDate(until: string): Date {
    // UNTIL=20260706T000000Z or UNTIL=20260706
    const cleaned = until.replace(/Z$/, '')
    if (cleaned.length >= 8) {
        const y = Number.parseInt(cleaned.slice(0, 4), 10)
        const m = Number.parseInt(cleaned.slice(4, 6), 10) - 1
        const d = Number.parseInt(cleaned.slice(6, 8), 10)
        let h = 23,
            min = 59,
            s = 59
        if (cleaned.length >= 15) {
            h = Number.parseInt(cleaned.slice(9, 11), 10)
            min = Number.parseInt(cleaned.slice(11, 13), 10)
            s = Number.parseInt(cleaned.slice(13, 15), 10)
        }
        return new Date(y, m, d, h, min, s)
    }
    return new Date(until)
}

function formatDateYYYYMMDD(date: Date): string {
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
}

function daysInMonth(year: number, month: number): number {
    return new Date(year, month + 1, 0).getDate()
}

function getNthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): Date | null {
    if (n > 0) {
        const first = new Date(year, month, 1)
        const firstDow = first.getDay()
        const day = 1 + ((weekday - firstDow + 7) % 7) + (n - 1) * 7
        if (day > daysInMonth(year, month)) return null
        return new Date(year, month, day)
    }
    // Negative position (e.g. -1 = last)
    const last = daysInMonth(year, month)
    const lastDate = new Date(year, month, last)
    const lastDow = lastDate.getDay()
    const day = last - ((lastDow - weekday + 7) % 7) + (n + 1) * 7
    if (day < 1) return null
    return new Date(year, month, day)
}

function parseByday(byday: string): { position: number | null; day: string } {
    const match = byday.match(/^(-?\d+)?([A-Z]{2})$/)
    if (!match) return { position: null, day: byday }
    return {
        position: match[1] ? Number.parseInt(match[1], 10) : null,
        day: match[2],
    }
}

export function generateOccurrences(
    eventStart: Date,
    rule: ParsedRRule,
    rangeStart: Date,
    rangeEnd: Date,
    maxOccurrences = 365
): Date[] {
    const results: Date[] = []
    const maxIter = maxOccurrences * 10

    switch (rule.freq) {
        case 'DAILY':
            generateDaily(eventStart, rule, rangeStart, rangeEnd, maxOccurrences, results, maxIter)
            break
        case 'WEEKLY':
            generateWeekly(eventStart, rule, rangeStart, rangeEnd, maxOccurrences, results, maxIter)
            break
        case 'MONTHLY':
            generateMonthly(eventStart, rule, rangeStart, rangeEnd, maxOccurrences, results, maxIter)
            break
        case 'YEARLY':
            generateYearly(eventStart, rule, rangeStart, rangeEnd, maxOccurrences, results, maxIter)
            break
    }

    return results
}

function generateDaily(
    eventStart: Date,
    rule: ParsedRRule,
    rangeStart: Date,
    rangeEnd: Date,
    maxOccurrences: number,
    results: Date[],
    maxIter: number
): number {
    const interval = rule.interval || 1
    const byDaySet = rule.byDay ? new Set(rule.byDay.map((d) => DAY_INDEX[d])) : null

    let totalEmitted = 0
    const current = new Date(eventStart)
    let iterations = 0

    while (current <= rangeEnd && iterations < maxIter) {
        iterations++

        if (rule.count && totalEmitted >= rule.count) break
        if (rule.until && current > rule.until) break

        const dayMatch = !byDaySet || byDaySet.has(current.getDay())

        if (dayMatch) {
            if (current >= rangeStart) {
                results.push(new Date(current))
            }
            totalEmitted++
            if (results.length >= maxOccurrences) break
        }

        if (byDaySet) {
            // When BYDAY is set with DAILY, advance one day at a time
            current.setDate(current.getDate() + 1)
        } else {
            current.setDate(current.getDate() + interval)
        }
    }

    return totalEmitted
}

function generateWeekly(
    eventStart: Date,
    rule: ParsedRRule,
    rangeStart: Date,
    rangeEnd: Date,
    maxOccurrences: number,
    results: Date[],
    maxIter: number
): number {
    const interval = rule.interval || 1
    const targetDays = rule.byDay ? rule.byDay.map((d) => DAY_INDEX[d]).sort((a, b) => a - b) : [eventStart.getDay()]

    let totalEmitted = 0
    // Start at the beginning of the event's week
    let weekStart = new Date(eventStart)
    weekStart.setDate(weekStart.getDate() - weekStart.getDay())
    weekStart.setHours(eventStart.getHours(), eventStart.getMinutes(), eventStart.getSeconds(), 0)

    let iterations = 0
    let weekNumber = 0

    while (weekStart <= rangeEnd && iterations < maxIter) {
        iterations++

        for (const dayIdx of targetDays) {
            const occurrence = new Date(weekStart)
            occurrence.setDate(weekStart.getDate() + dayIdx)

            if (occurrence < eventStart) continue
            if (occurrence > rangeEnd) break
            if (rule.until && occurrence > rule.until) break
            if (rule.count && totalEmitted >= rule.count) break

            totalEmitted++
            if (occurrence >= rangeStart) {
                results.push(occurrence)
            }
            if (results.length >= maxOccurrences) break
        }

        if (results.length >= maxOccurrences) break
        if (rule.count && totalEmitted >= rule.count) break
        if (rule.until && weekStart > rule.until) break

        weekNumber++
        weekStart = new Date(eventStart)
        weekStart.setDate(eventStart.getDate() - eventStart.getDay() + weekNumber * interval * 7)
        weekStart.setHours(eventStart.getHours(), eventStart.getMinutes(), eventStart.getSeconds(), 0)
    }

    return totalEmitted
}

function generateMonthly(
    eventStart: Date,
    rule: ParsedRRule,
    rangeStart: Date,
    rangeEnd: Date,
    maxOccurrences: number,
    results: Date[],
    maxIter: number
): number {
    const interval = rule.interval || 1

    let totalEmitted = 0
    let monthOffset = 0
    let iterations = 0

    while (iterations < maxIter) {
        iterations++

        const targetYear = eventStart.getFullYear() + Math.floor((eventStart.getMonth() + monthOffset) / 12)
        const targetMonth = (eventStart.getMonth() + monthOffset) % 12

        const occurrences = getMonthlyOccurrenceDates(rule, eventStart, targetYear, targetMonth)

        for (const occ of occurrences) {
            if (occ < eventStart) {
                monthOffset += interval
                continue
            }
            if (occ > rangeEnd) return totalEmitted
            if (rule.until && occ > rule.until) return totalEmitted
            if (rule.count && totalEmitted >= rule.count) return totalEmitted

            totalEmitted++
            if (occ >= rangeStart) {
                results.push(occ)
            }
            if (results.length >= maxOccurrences) return totalEmitted
        }

        monthOffset += interval
        const nextYear = eventStart.getFullYear() + Math.floor((eventStart.getMonth() + monthOffset) / 12)
        const nextMonth = (eventStart.getMonth() + monthOffset) % 12
        const nextMonthStart = new Date(nextYear, nextMonth, 1)
        if (nextMonthStart > rangeEnd && (!rule.count || totalEmitted >= rule.count)) break
        if (rule.count && totalEmitted >= rule.count) break
    }

    return totalEmitted
}

function getMonthlyOccurrenceDates(rule: ParsedRRule, eventStart: Date, year: number, month: number): Date[] {
    if (rule.byDay) {
        const dates: Date[] = []
        for (const bd of rule.byDay) {
            const { position, day } = parseByday(bd)
            const dayIndex = DAY_INDEX[day]
            if (dayIndex === undefined) continue

            if (position !== null) {
                const d = getNthWeekdayOfMonth(year, month, dayIndex, position)
                if (d) {
                    d.setHours(eventStart.getHours(), eventStart.getMinutes(), eventStart.getSeconds(), 0)
                    dates.push(d)
                }
            }
        }
        return dates
    }

    if (rule.byMonthDay) {
        const dates: Date[] = []
        const dim = daysInMonth(year, month)
        for (const day of rule.byMonthDay) {
            if (day > dim) continue
            const d = new Date(year, month, day)
            d.setHours(eventStart.getHours(), eventStart.getMinutes(), eventStart.getSeconds(), 0)
            dates.push(d)
        }
        return dates
    }

    // Default: same day of month as event start
    const day = eventStart.getDate()
    const dim = daysInMonth(year, month)
    if (day > dim) return []
    const d = new Date(year, month, day)
    d.setHours(eventStart.getHours(), eventStart.getMinutes(), eventStart.getSeconds(), 0)
    return [d]
}

function generateYearly(
    eventStart: Date,
    rule: ParsedRRule,
    rangeStart: Date,
    rangeEnd: Date,
    maxOccurrences: number,
    results: Date[],
    maxIter: number
): number {
    const interval = rule.interval || 1

    let totalEmitted = 0
    let yearOffset = 0
    let iterations = 0

    while (iterations < maxIter) {
        iterations++

        const year = eventStart.getFullYear() + yearOffset
        const month = eventStart.getMonth()
        const day = eventStart.getDate()

        const dim = daysInMonth(year, month)
        if (day <= dim) {
            const occ = new Date(year, month, day)
            occ.setHours(eventStart.getHours(), eventStart.getMinutes(), eventStart.getSeconds(), 0)

            if (occ > rangeEnd) break
            if (rule.until && occ > rule.until) break
            if (rule.count && totalEmitted >= rule.count) break

            if (occ >= eventStart) {
                totalEmitted++
                if (occ >= rangeStart) {
                    results.push(occ)
                }
                if (results.length >= maxOccurrences) break
            }
        }

        yearOffset += interval
    }

    return totalEmitted
}

export function expandRecurringEvents(options: {
    events: CalendarEvents[]
    rangeStart: Date
    rangeEnd: Date
    maxOccurrences?: number
}): CalendarEvents[] {
    const { events, rangeStart, rangeEnd, maxOccurrences = 365 } = options
    const result: CalendarEvents[] = []

    for (const event of events) {
        const rule = parseRRule(event.recurrence)

        if (!rule) {
            // Non-recurring: include if overlaps range
            if (eventOverlapsRange(event, rangeStart, rangeEnd)) {
                result.push(event)
            }
            continue
        }

        const eventStart = new Date(event.start)
        const eventEnd = new Date(event.end)
        const durationMs = eventEnd.getTime() - eventStart.getTime()

        const occurrences = generateOccurrences(eventStart, rule, rangeStart, rangeEnd, maxOccurrences)

        for (const occStart of occurrences) {
            const occEnd = new Date(occStart.getTime() + durationMs)
            const dateStr = formatDateYYYYMMDD(occStart)

            result.push({
                ...event,
                id: `${event.id}${OCCURRENCE_SEP}${dateStr}`,
                start: occStart.toISOString(),
                end: occEnd.toISOString(),
            })
        }
    }

    return result
}

function eventOverlapsRange(event: CalendarEvents, rangeStart: Date, rangeEnd: Date): boolean {
    const eventStart = new Date(event.start)
    const eventEnd = new Date(event.end)
    if (event.all_day) {
        const allDayStart = new Date(eventStart)
        allDayStart.setHours(0, 0, 0, 0)
        const allDayEnd = new Date(eventEnd)
        allDayEnd.setHours(23, 59, 59, 999)
        return allDayStart <= rangeEnd && allDayEnd >= rangeStart
    }
    return eventStart < rangeEnd && eventEnd > rangeStart
}

export function parseEventId(id: string): {
    baseId: string
    occurrenceDate?: string
} {
    const idx = id.indexOf(OCCURRENCE_SEP)
    if (idx === -1) {
        return { baseId: id }
    }
    return {
        baseId: id.slice(0, idx),
        occurrenceDate: id.slice(idx + OCCURRENCE_SEP.length),
    }
}

export function buildRRule(options: RRuleOptions): string {
    const parts: string[] = [`FREQ=${options.freq}`]

    if (options.interval && options.interval > 1) {
        parts.push(`INTERVAL=${options.interval}`)
    }

    if (options.byDay && options.byDay.length > 0) {
        parts.push(`BYDAY=${options.byDay.join(',')}`)
    }

    if (options.byMonthDay && options.byMonthDay.length > 0) {
        parts.push(`BYMONTHDAY=${options.byMonthDay.join(',')}`)
    }

    if (options.count) {
        parts.push(`COUNT=${options.count}`)
    }

    if (options.until) {
        const y = options.until.getFullYear()
        const m = String(options.until.getMonth() + 1).padStart(2, '0')
        const d = String(options.until.getDate()).padStart(2, '0')
        parts.push(`UNTIL=${y}${m}${d}T235959Z`)
    }

    return parts.join(';')
}

export function describeRRule(rrule: string, eventStart: Date): string {
    const rule = parseRRule(rrule)
    if (!rule) return ''

    const freq = rule.freq
    const interval = rule.interval || 1

    let base = ''

    if (freq === 'DAILY') {
        if (
            rule.byDay &&
            rule.byDay.length === 5 &&
            ['MO', 'TU', 'WE', 'TH', 'FR'].every((d) => rule.byDay?.includes(d))
        ) {
            base = 'Every weekday (Monday to Friday)'
        } else if (interval === 1) {
            base = 'Daily'
        } else {
            base = `Every ${interval} days`
        }
    } else if (freq === 'WEEKLY') {
        if (rule.byDay && rule.byDay.length > 0) {
            const dayNames = rule.byDay.map((d) => FULL_DAY_NAMES[DAY_INDEX[d]]).filter(Boolean)
            if (interval === 1) {
                base = `Weekly on ${dayNames.join(', ')}`
            } else {
                base = `Every ${interval} weeks on ${dayNames.join(', ')}`
            }
        } else {
            const dayName = FULL_DAY_NAMES[eventStart.getDay()]
            if (interval === 1) {
                base = `Weekly on ${dayName}`
            } else {
                base = `Every ${interval} weeks on ${dayName}`
            }
        }
    } else if (freq === 'MONTHLY') {
        if (rule.byDay && rule.byDay.length > 0) {
            const bd = rule.byDay[0]
            const { position, day } = parseByday(bd)
            const dayName = FULL_DAY_NAMES[DAY_INDEX[day]]
            const ordinal = getOrdinal(position ?? 1)
            if (interval === 1) {
                base = `Monthly on the ${ordinal} ${dayName}`
            } else {
                base = `Every ${interval} months on the ${ordinal} ${dayName}`
            }
        } else if (rule.byMonthDay && rule.byMonthDay.length > 0) {
            const day = rule.byMonthDay[0]
            if (interval === 1) {
                base = `Monthly on day ${day}`
            } else {
                base = `Every ${interval} months on day ${day}`
            }
        } else {
            const day = eventStart.getDate()
            if (interval === 1) {
                base = `Monthly on day ${day}`
            } else {
                base = `Every ${interval} months on day ${day}`
            }
        }
    } else if (freq === 'YEARLY') {
        const monthName = MONTH_NAMES[eventStart.getMonth()]
        const day = eventStart.getDate()
        if (interval === 1) {
            base = `Annually on ${monthName} ${day}`
        } else {
            base = `Every ${interval} years on ${monthName} ${day}`
        }
    }

    let suffix = ''
    if (rule.count) {
        suffix = `, ${rule.count} times`
    } else if (rule.until) {
        suffix = `, until ${MONTH_NAMES[rule.until.getMonth()]} ${rule.until.getDate()}, ${rule.until.getFullYear()}`
    }

    return base + suffix
}

function getOrdinal(n: number): string {
    if (n === -1) return 'last'
    if (n === 1) return 'first'
    if (n === 2) return 'second'
    if (n === 3) return 'third'
    if (n === 4) return 'fourth'
    if (n === 5) return 'fifth'
    return `${n}th`
}

export function getWeekdayPosition(date: Date): { position: number; day: string } {
    const dayOfMonth = date.getDate()
    const position = Math.ceil(dayOfMonth / 7)
    const day = DAY_NAMES[date.getDay()]
    return { position, day }
}

export function getContextualPresets(eventStart: Date): { label: string; value: string }[] {
    const dayName = FULL_DAY_NAMES[eventStart.getDay()]
    const dayAbbr = DAY_NAMES[eventStart.getDay()]
    const { position, day } = getWeekdayPosition(eventStart)
    const ordinal = getOrdinal(position)
    const monthName = MONTH_NAMES[eventStart.getMonth()]
    const dateNum = eventStart.getDate()

    return [
        { label: 'Does not repeat', value: '' },
        { label: 'Daily', value: 'FREQ=DAILY' },
        {
            label: `Weekly on ${dayName}`,
            value: `FREQ=WEEKLY;BYDAY=${dayAbbr}`,
        },
        {
            label: `Monthly on the ${ordinal} ${dayName}`,
            value: `FREQ=MONTHLY;BYDAY=${position}${day}`,
        },
        {
            label: `Annually on ${monthName} ${dateNum}`,
            value: 'FREQ=YEARLY',
        },
        {
            label: 'Every weekday (Monday to Friday)',
            value: 'FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR',
        },
        { label: 'Custom...', value: '__custom__' },
    ]
}
