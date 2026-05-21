import {
    cancelAllNotifications,
    requestNotificationPermission,
    scheduleNotification,
} from '@tinycld/core/lib/notifications'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useEffect } from 'react'
import { expandRecurringEvents } from '../lib/recurrence'
import { useCalendarUIStore } from '../stores/calendar-ui-store'
import type { CalendarEvents } from '../types'

/** How far ahead to look for upcoming events to schedule reminders */
const LOOKAHEAD_MS = 24 * 60 * 60 * 1000 // 24 hours
const RECHECK_MS = 5 * 60 * 1000

function getReminderTime(event: CalendarEvents): number | null {
    if (!event.reminder || event.reminder <= 0) return null
    const eventStart = new Date(event.start).getTime()
    return eventStart - event.reminder * 60 * 1000
}

function isInWindow(reminderTime: number, now: number, end: number) {
    return reminderTime > now && reminderTime <= end
}

async function scheduleEventReminders(events: CalendarEvents[], alreadyScheduled: Set<string>) {
    const now = Date.now()
    const lookaheadEnd = now + LOOKAHEAD_MS
    const nextScheduled = new Set<string>()

    for (const event of events) {
        const reminderTime = getReminderTime(event)
        if (!reminderTime || !isInWindow(reminderTime, now, lookaheadEnd)) continue

        const identifier = `cal-reminder-${event.id}`
        nextScheduled.add(identifier)
        if (alreadyScheduled.has(identifier)) continue

        await scheduleNotification({
            title: event.title,
            body: `Starts in ${event.reminder} minutes`,
            identifier,
            triggerAt: new Date(reminderTime),
            data: { eventId: event.id },
        })
    }

    return nextScheduled
}

/**
 * Watches calendar events and schedules OS-level notifications for events
 * with a reminder value > 0.
 *
 * Implemented imperatively (collection iteration + subscribeChanges) rather
 * than via useOrgLiveQuery. A live-query subscription here cross-fires with
 * the screens' own live queries when views remount on mode change, producing
 * "setState during render" warnings (TanStack DB starts sync synchronously
 * on collection creation, which notifies sibling subscribers mid-render).
 */
export function useEventReminders() {
    const [eventsCollection] = useStore('calendar_events')
    const visibleIds = useCalendarUIStore((s) => s.visibleIds)

    useEffect(() => {
        if (visibleIds.length === 0) return
        const visibleSet = new Set(visibleIds)
        let cancelled = false
        let scheduled = new Set<string>()

        async function run() {
            const granted = await requestNotificationPermission()
            if (!granted || cancelled) return

            const now = new Date()
            now.setSeconds(0, 0)
            const end = new Date(now.getTime() + LOOKAHEAD_MS)

            const rawEvents: CalendarEvents[] = []
            for (const event of eventsCollection.values()) {
                if (!visibleSet.has(event.calendar)) continue
                if (new Date(event.start) > end) continue
                if (!event.recurrence && new Date(event.end) <= now) continue
                rawEvents.push(event as CalendarEvents)
            }

            const occurrences = expandRecurringEvents({
                events: rawEvents,
                rangeStart: now,
                rangeEnd: end,
            })

            scheduled = await scheduleEventReminders(occurrences, scheduled)
        }

        run()

        const subscription = eventsCollection.subscribeChanges(() => {
            run()
        })
        const interval = setInterval(run, RECHECK_MS)

        return () => {
            cancelled = true
            clearInterval(interval)
            subscription.unsubscribe()
        }
    }, [eventsCollection, visibleIds])

    useEffect(() => {
        return () => {
            cancelAllNotifications()
        }
    }, [])
}
