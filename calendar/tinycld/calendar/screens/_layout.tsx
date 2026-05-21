import { ScreenHeader } from '@tinycld/core/components/ScreenHeader'
import { FrozenSlideStack } from '@tinycld/core/components/workspace/FrozenStack'
import { useBreakpoint } from '@tinycld/core/components/workspace/useBreakpoint'
import { captureException } from '@tinycld/core/lib/errors'
import { mutation, useMutation } from '@tinycld/core/lib/mutations'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { View } from 'react-native'
import { CalendarFAB } from '../components/CalendarFAB'
import { CalendarHeader } from '../components/CalendarHeader'
import { EventDetailPopover } from '../components/EventDetailPopover'
import { EventQuickCreate } from '../components/EventQuickCreate'
import { useEventDetail } from '../hooks/useCalendarEvents'
import { useCalendarView } from '../hooks/useCalendarView'

export default function CalendarLayout() {
    const { popover, closePopover } = useCalendarView()
    const isMobile = useBreakpoint() === 'mobile'
    const [eventsCollection] = useStore('calendar_events')

    const eventId = popover.type === 'event-detail' ? popover.eventId : undefined
    const { event, calendar } = useEventDetail(eventId)

    const deleteEvent = useMutation({
        mutationFn: mutation(function* (eventId: string) {
            yield eventsCollection.delete(eventId)
        }),
        onError: (error) => captureException('CalendarDeleteEvent', error),
    })

    return (
        <View className="flex-1 bg-background">
            <ScreenHeader>
                <CalendarHeader />
            </ScreenHeader>
            <View className="flex-1">
                <FrozenSlideStack />
            </View>

            <CalendarFAB isVisible={isMobile} />

            <EventQuickCreate
                isVisible={popover.type === 'quick-create'}
                initialDate={popover.type === 'quick-create' ? popover.date : new Date()}
                initialHour={popover.type === 'quick-create' ? popover.hour : 9}
                onClose={closePopover}
            />

            <EventDetailPopover
                isVisible={popover.type === 'event-detail'}
                event={event}
                calendarName={calendar?.name ?? ''}
                calendarColorKey={calendar?.color ?? 'blue'}
                anchorRect={popover.type === 'event-detail' ? popover.anchorRect : undefined}
                onClose={closePopover}
                onDelete={(id) => deleteEvent.mutate(id)}
                isReadOnly={!!calendar?.subscription_url}
            />
        </View>
    )
}
