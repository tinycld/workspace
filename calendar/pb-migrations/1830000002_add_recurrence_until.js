/// <reference path="../../../server/pb_data/types.d.ts" />

// Denormalize the UNTIL boundary from the recurrence string onto a
// queryable date column. The calendar event list switches to on-demand
// fetching scoped to a date range; without this column we'd have to load
// every recurring event ever created (the UNTIL inside the RRULE string
// isn't comparable in a SQL WHERE clause).
//
// Maintenance: a Go hook on calendar_events create/update parses the
// recurrence string and writes recurrence_until. Empty for non-recurring
// events and for unbounded recurring events (no UNTIL / no COUNT).
migrate(
    app => {
        const events = app.findCollectionByNameOrId('calendar_events')

        events.fields.add(
            new Field({
                id: 'cal_events_recurrence_until',
                name: 'recurrence_until',
                type: 'date',
                required: false,
            })
        )

        // Index for the on-demand query: "recurring events whose recurrence
        // window covers the visible range" — calendar + recurrence_until
        // matches the typical (visible mailbox set, range start) lookup.
        events.indexes = [
            ...(events.indexes ?? []),
            'CREATE INDEX `idx_cal_events_calendar_recurrence_until` ON `calendar_events` (`calendar`, `recurrence_until`)',
        ]

        app.save(events)

        // Backfill existing rows: parse UNTIL=YYYYMMDD[Thhmmss[Z]] from the
        // recurrence string. Anything else (legacy keywords, COUNT-only
        // recurrence, no UNTIL) leaves recurrence_until empty — those
        // events are open-ended in time.
        const rows = arrayOf(new DynamicModel({ id: '', recurrence: '' }))
        app.db()
            .newQuery(`SELECT id, recurrence FROM calendar_events WHERE recurrence != ''`)
            .all(rows)
        for (const row of rows) {
            const until = parseUntil(row.recurrence)
            if (!until) continue
            app.db()
                .newQuery('UPDATE calendar_events SET recurrence_until = {:until} WHERE id = {:id}')
                .bind({ until, id: row.id })
                .execute()
        }
    },
    app => {
        const events = app.findCollectionByNameOrId('calendar_events')
        events.fields.removeById('cal_events_recurrence_until')
        events.indexes = (events.indexes ?? []).filter(
            sql => !sql.includes('idx_cal_events_calendar_recurrence_until')
        )
        app.save(events)
    }
)

// parseUntil extracts a SQL-friendly date string from the UNTIL component
// of a recurrence string. Returns "" if no UNTIL is present so the caller
// can skip the row.
//
// Inputs we accept:
//   "UNTIL=20260706T235959Z" → "2026-07-06 23:59:59"
//   "FREQ=DAILY;UNTIL=20260706"           → "2026-07-06 00:00:00"
//   "RRULE:FREQ=WEEKLY;UNTIL=20260706"    → "2026-07-06 00:00:00"
//   anything else                          → ""
function parseUntil(rrule) {
    const match = String(rrule).match(/UNTIL=(\d{8})(?:T(\d{6})Z?)?/)
    if (!match) return ''
    const date = match[1]
    const y = date.slice(0, 4)
    const mo = date.slice(4, 6)
    const d = date.slice(6, 8)
    const time = match[2]
    if (time) {
        const h = time.slice(0, 2)
        const mi = time.slice(2, 4)
        const s = time.slice(4, 6)
        return `${y}-${mo}-${d} ${h}:${mi}:${s}`
    }
    return `${y}-${mo}-${d} 00:00:00`
}
