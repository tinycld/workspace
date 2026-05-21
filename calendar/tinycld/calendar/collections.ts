import type { CoreStores } from '@tinycld/core/lib/pocketbase'
import type { Schema } from '@tinycld/core/types/pbSchema'
import type { createCollection } from 'pbtsdb/core'
import { BasicIndex } from 'pbtsdb/core'
import type { CalendarSchema } from './types'

type MergedSchema = Schema & CalendarSchema

export function registerCollections(
    newCollection: ReturnType<typeof createCollection<MergedSchema>>,
    coreStores: CoreStores
) {
    const calendar_calendars = newCollection('calendar_calendars', {
        omitOnInsert: ['created', 'updated'] as const,
        collectionOptions: {
            autoIndex: 'eager' as const,
            defaultIndexType: BasicIndex,
        },
    })

    const calendar_members = newCollection('calendar_members', {
        omitOnInsert: ['created', 'updated'] as const,
        expand: { calendar: calendar_calendars, user_org: coreStores.user_org },
        collectionOptions: {
            autoIndex: 'eager' as const,
            defaultIndexType: BasicIndex,
        },
    })

    const calendar_events = newCollection('calendar_events', {
        // recurrence_until is computed by a server hook (see
        // calendar/server/recurrence_until.go), so clients never write it.
        omitOnInsert: ['created', 'updated', 'recurrence_until'] as const,
        // No `expand`: on-demand fetches were carrying duplicate
        // calendar_calendars + user_org rows per event. Both relations
        // are already loaded eagerly (calendar_calendars, user_org), so
        // consumers look them up by id locally — see useCalendarData
        // and useCurrentUserOrg.
        syncMode: 'on-demand' as const,
        collectionOptions: {
            autoIndex: 'eager' as const,
            defaultIndexType: BasicIndex,
        },
    })

    return {
        calendar_calendars,
        calendar_members,
        calendar_events,
    }
}
