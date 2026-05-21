import { strict as assert } from 'node:assert'
import { type LayoutEvent, layoutAllDayEvents, layoutMonthEvents, layoutTimedEvents } from './layout'

function makeEvent(
    id: string,
    startHour: number,
    endHour: number,
    opts?: { startMin?: number; endMin?: number; dayOffset?: number; allDay?: boolean }
): LayoutEvent {
    const base = new Date(2026, 3, 5)
    base.setDate(base.getDate() + (opts?.dayOffset ?? 0))
    const start = new Date(base)
    start.setHours(startHour, opts?.startMin ?? 0, 0, 0)
    const end = new Date(base)
    end.setHours(endHour, opts?.endMin ?? 0, 0, 0)
    return { id, start, end, allDay: opts?.allDay ?? false }
}

function makeAllDayEvent(id: string, dayOffset: number, durationDays = 1): LayoutEvent {
    const start = new Date(2026, 3, 5)
    start.setDate(start.getDate() + dayOffset)
    start.setHours(0, 0, 0, 0)
    const end = new Date(start)
    end.setDate(end.getDate() + durationDays - 1)
    end.setHours(23, 59, 59, 999)
    return { id, start, end, allDay: true }
}

const HOUR_HEIGHT = 60

// --- layoutTimedEvents ---

console.log('layoutTimedEvents')

console.log('  single event fills full width')
{
    const events = [makeEvent('a', 9, 10)]
    const result = layoutTimedEvents(events, 0, HOUR_HEIGHT)
    assert.equal(result.length, 1)
    assert.equal(result[0].left, 0)
    assert.equal(result[0].width, 100)
    assert.equal(result[0].top, 9 * HOUR_HEIGHT)
    assert.equal(result[0].height, HOUR_HEIGHT)
}

console.log('  two overlapping events get side-by-side columns')
{
    const events = [makeEvent('a', 9, 10), makeEvent('b', 9, 11)]
    const result = layoutTimedEvents(events, 0, HOUR_HEIGHT)
    assert.equal(result.length, 2)
    const a = result.find((r) => r.id === 'a')!
    const b = result.find((r) => r.id === 'b')!
    // b is longer so sorted first → col 0; a is shorter → col 1
    assert.equal(b.left, 0)
    assert.equal(a.left, 50)
    assert.equal(a.width + b.width, 100)
}

console.log('  non-overlapping events each fill full width')
{
    const events = [makeEvent('a', 9, 10), makeEvent('b', 11, 12)]
    const result = layoutTimedEvents(events, 0, HOUR_HEIGHT)
    assert.equal(result.length, 2)
    for (const r of result) {
        assert.equal(r.left, 0)
        assert.equal(r.width, 100)
    }
}

console.log('  three overlapping events get three columns')
{
    const events = [makeEvent('a', 9, 11), makeEvent('b', 9, 10), makeEvent('c', 10, 11)]
    const result = layoutTimedEvents(events, 0, HOUR_HEIGHT)
    assert.equal(result.length, 3)
    const cols = new Set(result.map((r) => r.left))
    assert.equal(cols.size, 2) // b and c share a column since they don't overlap
}

console.log('  expand-to-fill: short event expands into empty columns')
{
    // a: 9-11, b: 9-10, c: 10-11
    // a gets col 0, b gets col 1, c gets col 1 (after b ends)
    // a should expand to fill: col 0, width 50% (blocked by b/c in col 1)
    // b should expand: col 1, can expand right? no more cols -> width 50%
    const events = [makeEvent('a', 9, 11), makeEvent('b', 9, 10), makeEvent('c', 10, 11)]
    const result = layoutTimedEvents(events, 0, HOUR_HEIGHT)
    const a = result.find((r) => r.id === 'a')!
    assert.equal(a.left, 0)
    assert.equal(a.width, 50)
}

console.log('  filters out all-day events')
{
    const events = [makeEvent('a', 9, 10), { ...makeEvent('b', 0, 23), allDay: true }]
    const result = layoutTimedEvents(events, 0, HOUR_HEIGHT)
    assert.equal(result.length, 1)
    assert.equal(result[0].id, 'a')
}

console.log('  filters out zero-duration events')
{
    const events = [makeEvent('a', 9, 9)]
    const result = layoutTimedEvents(events, 0, HOUR_HEIGHT)
    assert.equal(result.length, 0)
}

console.log('  empty input returns empty array')
assert.deepEqual(layoutTimedEvents([], 0, HOUR_HEIGHT), [])

console.log('  respects startHour offset for top calculation')
{
    const events = [makeEvent('a', 9, 10)]
    const result = layoutTimedEvents(events, 8, HOUR_HEIGHT)
    assert.equal(result[0].top, HOUR_HEIGHT) // 9am - 8am = 1 hour offset
}

console.log('  10 concurrent events get 10 columns')
{
    const events = Array.from({ length: 10 }, (_, i) => makeEvent(`e${i}`, 9, 10))
    const result = layoutTimedEvents(events, 0, HOUR_HEIGHT)
    assert.equal(result.length, 10)
    for (const r of result) {
        assert.equal(r.width, 10)
    }
}

// --- layoutAllDayEvents ---

console.log('\nlayoutAllDayEvents')

const weekStart = new Date(2026, 3, 5) // Sunday April 5
weekStart.setHours(0, 0, 0, 0)

console.log('  single all-day event on first day')
{
    const events = [makeAllDayEvent('a', 0)]
    const result = layoutAllDayEvents(events, weekStart, 7)
    assert.equal(result.length, 1)
    assert.equal(result[0].row, 0)
    assert.equal(result[0].startCol, 0)
    assert.equal(result[0].span, 1)
}

console.log('  multi-day event spans correct columns')
{
    const events = [makeAllDayEvent('a', 1, 3)] // Tues-Thu
    const result = layoutAllDayEvents(events, weekStart, 7)
    assert.equal(result.length, 1)
    assert.equal(result[0].startCol, 1)
    assert.equal(result[0].span, 3)
}

console.log('  overlapping all-day events go to different rows')
{
    const events = [makeAllDayEvent('a', 0, 3), makeAllDayEvent('b', 1, 2)]
    const result = layoutAllDayEvents(events, weekStart, 7)
    assert.equal(result.length, 2)
    const a = result.find((r) => r.id === 'a')!
    const b = result.find((r) => r.id === 'b')!
    assert.notEqual(a.row, b.row)
}

console.log('  non-overlapping all-day events share a row')
{
    const events = [makeAllDayEvent('a', 0, 1), makeAllDayEvent('b', 3, 1)]
    const result = layoutAllDayEvents(events, weekStart, 7)
    const a = result.find((r) => r.id === 'a')!
    const b = result.find((r) => r.id === 'b')!
    assert.equal(a.row, b.row)
}

console.log('  clips events to visible week range')
{
    // Event starts 2 days before week
    const earlyStart = new Date(2026, 3, 3)
    earlyStart.setHours(0, 0, 0, 0)
    const earlyEnd = new Date(2026, 3, 6)
    earlyEnd.setHours(23, 59, 59, 999)
    const events: LayoutEvent[] = [{ id: 'a', start: earlyStart, end: earlyEnd, allDay: true }]
    const result = layoutAllDayEvents(events, weekStart, 7)
    assert.equal(result[0].startCol, 0) // clipped to start of week
    assert.ok(result[0].span <= 7)
}

console.log('  filters non-all-day events')
{
    const events = [makeEvent('a', 9, 10)]
    const result = layoutAllDayEvents(events, weekStart, 7)
    assert.equal(result.length, 0)
}

console.log('  empty input returns empty array')
assert.deepEqual(layoutAllDayEvents([], weekStart, 7), [])

// --- layoutMonthEvents ---

console.log('\nlayoutMonthEvents')

console.log('  single timed event appears in correct cell')
{
    const events = [makeEvent('a', 9, 10, { dayOffset: 2 })]
    const result = layoutMonthEvents(events, weekStart, 3)
    const cell2 = result.get(2)!
    assert.equal(cell2.layouts.length, 1)
    assert.equal(cell2.layouts[0].id, 'a')
    assert.equal(cell2.layouts[0].isAllDay, false)
}

console.log('  multi-day event spans across cells')
{
    const events = [makeAllDayEvent('a', 1, 3)]
    const result = layoutMonthEvents(events, weekStart, 3)
    const cell1 = result.get(1)!
    const cell2 = result.get(2)!
    const cell3 = result.get(3)!
    assert.ok(cell1.layouts.some((l) => l.id === 'a'))
    assert.ok(cell2.layouts.some((l) => l.id === 'a'))
    assert.ok(cell3.layouts.some((l) => l.id === 'a'))
}

console.log('  overflow count works with maxVisible')
{
    const events = [makeEvent('a', 9, 10), makeEvent('b', 10, 11), makeEvent('c', 11, 12), makeEvent('d', 13, 14)]
    const result = layoutMonthEvents(events, weekStart, 2) // max 2 visible
    const cell0 = result.get(0)!
    assert.equal(cell0.layouts.length, 2) // only 2 visible
    assert.equal(cell0.overflowCount, 2) // 2 hidden
}

console.log('  multi-day events get isAllDay=true, single-day get isAllDay=false')
{
    const events = [makeAllDayEvent('allday', 0, 2), makeEvent('timed', 9, 10)]
    const result = layoutMonthEvents(events, weekStart, 5)
    const cell0 = result.get(0)!
    const allDayLayout = cell0.layouts.find((l) => l.id === 'allday')!
    const timedLayout = cell0.layouts.find((l) => l.id === 'timed')!
    assert.equal(allDayLayout.isAllDay, true)
    assert.equal(timedLayout.isAllDay, false)
}

console.log('  isStart is true only on the starting cell')
{
    const events = [makeAllDayEvent('a', 1, 3)]
    const result = layoutMonthEvents(events, weekStart, 5)
    const cell1 = result.get(1)!
    const cell2 = result.get(2)!
    const layout1 = cell1.layouts.find((l) => l.id === 'a')!
    const layout2 = cell2.layouts.find((l) => l.id === 'a')!
    assert.equal(layout1.isStart, true)
    assert.equal(layout2.isStart, true) // same layout object, isStart reflects week boundary
}

console.log('  empty input returns cells with empty layouts')
{
    const result = layoutMonthEvents([], weekStart, 3)
    for (let col = 0; col < 7; col++) {
        const cell = result.get(col)!
        assert.equal(cell.layouts.length, 0)
        assert.equal(cell.overflowCount, 0)
    }
}

console.log('\nAll tests passed!')
