export interface LayoutEvent {
    id: string
    start: Date
    end: Date
    allDay: boolean
}

export interface TimedEventLayout {
    id: string
    top: number
    height: number
    left: number
    width: number
}

export interface AllDayEventLayout {
    id: string
    row: number
    startCol: number
    span: number
}

export interface MonthEventLayout {
    id: string
    row: number
    startCol: number
    span: number
    isStart: boolean
    isAllDay: boolean
}

export interface MonthCellLayout {
    layouts: MonthEventLayout[]
    overflowCount: number
}

function eventsOverlap(a: LayoutEvent, b: LayoutEvent): boolean {
    return a.start < b.end && a.end > b.start
}

export function layoutTimedEvents(events: LayoutEvent[], startHour: number, hourHeight: number): TimedEventLayout[] {
    const timed = events.filter((e) => !e.allDay && e.end > e.start)
    if (timed.length === 0) return []

    const sorted = [...timed].sort((a, b) => {
        const startDiff = a.start.getTime() - b.start.getTime()
        if (startDiff !== 0) return startDiff
        return b.end.getTime() - b.start.getTime() - (a.end.getTime() - a.start.getTime())
    })

    const clusters: LayoutEvent[][] = []
    let clusterEnd = sorted[0].end
    let currentCluster: LayoutEvent[] = [sorted[0]]

    for (let i = 1; i < sorted.length; i++) {
        const event = sorted[i]
        if (event.start >= clusterEnd) {
            clusters.push(currentCluster)
            currentCluster = [event]
            clusterEnd = event.end
        } else {
            currentCluster.push(event)
            if (event.end > clusterEnd) clusterEnd = event.end
        }
    }
    clusters.push(currentCluster)

    const results: TimedEventLayout[] = []
    const startMinuteOffset = startHour * 60

    for (const cluster of clusters) {
        const columns: LayoutEvent[][] = []
        const eventCol = new Map<string, number>()

        for (const event of cluster) {
            let placed = false
            for (let c = 0; c < columns.length; c++) {
                const lastInCol = columns[c][columns[c].length - 1]
                if (lastInCol.end <= event.start) {
                    columns[c].push(event)
                    eventCol.set(event.id, c)
                    placed = true
                    break
                }
            }
            if (!placed) {
                eventCol.set(event.id, columns.length)
                columns.push([event])
            }
        }

        const totalCols = columns.length

        for (const event of cluster) {
            const col = eventCol.get(event.id) ?? 0
            let effectiveSpan = 1
            for (let c = col + 1; c < totalCols; c++) {
                const hasConflict = columns[c].some((other) => eventsOverlap(event, other))
                if (hasConflict) break
                effectiveSpan++
            }

            const startMinutes = event.start.getHours() * 60 + event.start.getMinutes()
            const endMinutes = event.end.getHours() * 60 + event.end.getMinutes()

            results.push({
                id: event.id,
                top: ((startMinutes - startMinuteOffset) / 60) * hourHeight,
                height: ((endMinutes - startMinutes) / 60) * hourHeight,
                left: (col / totalCols) * 100,
                width: (effectiveSpan / totalCols) * 100,
            })
        }
    }

    return results
}

export function layoutAllDayEvents(events: LayoutEvent[], weekStart: Date, dayCount: number): AllDayEventLayout[] {
    const allDay = events.filter((e) => e.allDay)
    if (allDay.length === 0) return []

    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekEnd.getDate() + dayCount)

    const sorted = [...allDay].sort((a, b) => {
        const durA = a.end.getTime() - a.start.getTime()
        const durB = b.end.getTime() - b.start.getTime()
        if (durB !== durA) return durB - durA
        return a.start.getTime() - b.start.getTime()
    })

    const weekStartTime = new Date(weekStart)
    weekStartTime.setHours(0, 0, 0, 0)

    const results: AllDayEventLayout[] = []
    const rows: boolean[][] = []

    for (const event of sorted) {
        const eventStart = new Date(event.start)
        eventStart.setHours(0, 0, 0, 0)
        const eventEnd = new Date(event.end)
        eventEnd.setHours(23, 59, 59, 999)

        const clippedStart = eventStart < weekStartTime ? weekStartTime : eventStart
        const clippedEnd = eventEnd > weekEnd ? weekEnd : eventEnd

        const startCol = Math.max(
            0,
            Math.floor((clippedStart.getTime() - weekStartTime.getTime()) / (24 * 60 * 60 * 1000))
        )
        const endCol = Math.min(
            dayCount,
            Math.ceil((clippedEnd.getTime() - weekStartTime.getTime()) / (24 * 60 * 60 * 1000))
        )
        const span = Math.max(1, endCol - startCol)

        let placedRow = -1
        for (let r = 0; r < rows.length; r++) {
            let fits = true
            for (let c = startCol; c < startCol + span; c++) {
                if (rows[r][c]) {
                    fits = false
                    break
                }
            }
            if (fits) {
                placedRow = r
                break
            }
        }

        if (placedRow === -1) {
            placedRow = rows.length
            rows.push(new Array(dayCount).fill(false))
        }

        for (let c = startCol; c < startCol + span; c++) {
            rows[placedRow][c] = true
        }

        results.push({ id: event.id, row: placedRow, startCol, span })
    }

    return results
}

export function layoutMonthEvents(
    events: LayoutEvent[],
    weekRowStart: Date,
    maxVisible: number
): Map<number, MonthCellLayout> {
    const weekStart = new Date(weekRowStart)
    weekStart.setHours(0, 0, 0, 0)

    const multiDay: LayoutEvent[] = []
    const singleDay: LayoutEvent[] = []

    for (const event of events) {
        const eventStart = new Date(event.start)
        const eventEnd = new Date(event.end)
        eventStart.setHours(0, 0, 0, 0)
        eventEnd.setHours(0, 0, 0, 0)
        if (event.allDay || eventStart.getTime() !== eventEnd.getTime()) {
            multiDay.push(event)
        } else {
            singleDay.push(event)
        }
    }

    multiDay.sort((a, b) => {
        const durA = a.end.getTime() - a.start.getTime()
        const durB = b.end.getTime() - b.start.getTime()
        if (durB !== durA) return durB - durA
        return a.start.getTime() - b.start.getTime()
    })

    singleDay.sort((a, b) => a.start.getTime() - b.start.getTime())

    const rowSlots: boolean[][] = []
    const layouts: MonthEventLayout[] = []

    for (const event of multiDay) {
        const eventStart = new Date(event.start)
        eventStart.setHours(0, 0, 0, 0)
        const eventEnd = new Date(event.end)
        eventEnd.setHours(23, 59, 59, 999)

        const weekEnd = new Date(weekStart)
        weekEnd.setDate(weekEnd.getDate() + 7)

        const clippedStart = eventStart < weekStart ? weekStart : eventStart
        const clippedEnd = eventEnd > weekEnd ? weekEnd : eventEnd

        const startCol = Math.max(0, Math.floor((clippedStart.getTime() - weekStart.getTime()) / (24 * 60 * 60 * 1000)))
        const endCol = Math.min(7, Math.ceil((clippedEnd.getTime() - weekStart.getTime()) / (24 * 60 * 60 * 1000)))
        const span = Math.max(1, endCol - startCol)
        const isStart = eventStart >= weekStart

        let placedRow = -1
        for (let r = 0; r < rowSlots.length; r++) {
            let fits = true
            for (let c = startCol; c < startCol + span; c++) {
                if (rowSlots[r][c]) {
                    fits = false
                    break
                }
            }
            if (fits) {
                placedRow = r
                break
            }
        }

        if (placedRow === -1) {
            placedRow = rowSlots.length
            rowSlots.push(new Array(7).fill(false))
        }

        for (let c = startCol; c < startCol + span; c++) {
            rowSlots[placedRow][c] = true
        }

        layouts.push({
            id: event.id,
            row: placedRow,
            startCol,
            span,
            isStart,
            isAllDay: true,
        })
    }

    const cellSingleEvents = new Map<number, LayoutEvent[]>()
    for (const event of singleDay) {
        const eventDate = new Date(event.start)
        eventDate.setHours(0, 0, 0, 0)
        const col = Math.floor((eventDate.getTime() - weekStart.getTime()) / (24 * 60 * 60 * 1000))
        if (col >= 0 && col < 7) {
            const existing = cellSingleEvents.get(col) ?? []
            existing.push(event)
            cellSingleEvents.set(col, existing)
        }
    }

    cellSingleEvents.forEach((cellEvents, col) => {
        for (const event of cellEvents) {
            let placedRow = -1
            for (let r = 0; r < rowSlots.length; r++) {
                if (!rowSlots[r][col]) {
                    placedRow = r
                    break
                }
            }
            if (placedRow === -1) {
                placedRow = rowSlots.length
                rowSlots.push(new Array(7).fill(false))
            }
            rowSlots[placedRow][col] = true

            layouts.push({
                id: event.id,
                row: placedRow,
                startCol: col,
                span: 1,
                isStart: true,
                isAllDay: false,
            })
        }
    })

    const cellMap = new Map<number, MonthCellLayout>()
    for (let col = 0; col < 7; col++) {
        const cellLayouts: MonthEventLayout[] = []
        for (const layout of layouts) {
            if (col >= layout.startCol && col < layout.startCol + layout.span) {
                cellLayouts.push(layout)
            }
        }
        cellLayouts.sort((a, b) => a.row - b.row)

        const visible = cellLayouts.filter((l) => l.row < maxVisible)
        const totalInCell = cellLayouts.length
        const overflowCount = totalInCell > maxVisible ? totalInCell - maxVisible : 0

        cellMap.set(col, { layouts: visible, overflowCount })
    }

    return cellMap
}
