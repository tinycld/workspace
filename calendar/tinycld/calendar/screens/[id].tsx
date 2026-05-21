import { eq } from '@tanstack/db'
import { useBreakpoint } from '@tinycld/core/components/workspace/useBreakpoint'
import { handleMutationErrorsWithForm } from '@tinycld/core/lib/errors'
import { mutation, useMutation } from '@tinycld/core/lib/mutations'
import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useCurrentUserOrg } from '@tinycld/core/lib/use-current-user-org'
import { useNavigateBack } from '@tinycld/core/lib/use-navigate-back'
import { useOrgInfo } from '@tinycld/core/lib/use-org-info'
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'
import { Button, ButtonText } from '@tinycld/core/ui/button'
import { useForm, z, zodResolver } from '@tinycld/core/ui/form'
import { useLocalSearchParams } from 'expo-router'
import { ArrowLeft } from 'lucide-react-native'
import { newRecordId } from 'pbtsdb/core'
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native'
import { EventForm } from '../components/EventForm'
import { EventGuestList } from '../components/EventGuestList'
import { useVisibleCalendars } from '../hooks/useCalendarEvents'
import { parseEventId } from '../lib/recurrence'

const eventSchema = z.object({
    title: z.string().min(1, 'Title is required'),
    description: z.string(),
    location: z.string(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD format'),
    startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:MM format'),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD format'),
    endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:MM format'),
    all_day: z.boolean(),
    recurrence: z.string(),
    calendar: z.string(),
    busy_status: z.enum(['busy', 'free']),
    visibility: z.enum(['default', 'public', 'private']),
    reminderMinutes: z.number(),
})

function combineDateAndTime(dateStr: string, timeStr: string): string {
    return new Date(`${dateStr}T${timeStr}:00`).toISOString()
}

// Rounds a Date forward to the next full half-hour. Seconds and ms cleared
// so the form fields show clean HH:00 / HH:30 values.
function nextHalfHour(d: Date): Date {
    const out = new Date(d)
    out.setSeconds(0, 0)
    const minutes = out.getMinutes()
    const target = minutes < 30 ? 30 : 60
    out.setMinutes(target)
    return out
}

export default function EventEditorScreen() {
    const { id } = useLocalSearchParams<{ id: string }>()
    const orgHref = useOrgHref()
    const fgColor = useThemeColor('foreground')
    const mutedColor = useThemeColor('muted-foreground')
    const breakpoint = useBreakpoint()
    const { orgSlug } = useOrgInfo()
    const userOrg = useCurrentUserOrg(orgSlug)
    const { calendars, mineCalendars, calendarMap } = useVisibleCalendars()
    const [eventsCollection] = useStore('calendar_events')
    const navigateBack = useNavigateBack(() => orgHref('calendar'))

    const { baseId } = parseEventId(id ?? '')
    const isNew = !id || id === 'new'
    const lookupId = isNew ? '' : baseId

    const { data: existingEvents } = useOrgLiveQuery(
        query => {
            if (!lookupId) return null
            return query.from({ evt: eventsCollection }).where(({ evt }) => eq(evt.id, lookupId))
        },
        [lookupId]
    )
    const event = existingEvents?.[0]

    // For new events, default start to the next half-hour and end to one
    // hour later — a common-sense default that avoids the zero-duration
    // start==end footgun (a fresh `new Date()` for both fields produces
    // two identical timestamps because they're computed in the same render).
    const startDate = event ? new Date(event.start) : nextHalfHour(new Date())
    const endDate = event ? new Date(event.end) : new Date(startDate.getTime() + 60 * 60 * 1000)

    const defaultCalendar = mineCalendars[0]?.id ?? calendars[0]?.id ?? ''

    const {
        control,
        handleSubmit,
        setError,
        getValues,
        watch,
        formState: { errors, isSubmitted },
    } = useForm({
        mode: 'onChange',
        resolver: zodResolver(eventSchema),
        // For new events, use `values` (not `defaultValues`) so the form
        // re-syncs when defaultCalendar resolves from the live query —
        // otherwise the form snapshots calendar='' on first render and
        // submitting that yields a 400 from PB's required-field validation.
        values: event
            ? {
                  title: event.title,
                  description: event.description,
                  location: event.location,
                  startDate: startDate.toISOString().split('T')[0],
                  startTime: startDate.toTimeString().slice(0, 5),
                  endDate: endDate.toISOString().split('T')[0],
                  endTime: endDate.toTimeString().slice(0, 5),
                  all_day: event.all_day,
                  recurrence: event.recurrence,
                  calendar: event.calendar,
                  busy_status: event.busy_status,
                  visibility: event.visibility,
                  reminderMinutes: event.reminder,
              }
            : {
                  title: '',
                  description: '',
                  location: '',
                  startDate: startDate.toISOString().split('T')[0],
                  startTime: startDate.toTimeString().slice(0, 5),
                  endDate: endDate.toISOString().split('T')[0],
                  endTime: endDate.toTimeString().slice(0, 5),
                  all_day: false,
                  recurrence: '',
                  calendar: defaultCalendar,
                  busy_status: 'busy' as const,
                  visibility: 'default' as const,
                  reminderMinutes: 30,
              },
    })

    const startDateValue = watch('startDate')

    const createEvent = useMutation({
        mutationFn: mutation(function* (data: z.infer<typeof eventSchema>) {
            if (!userOrg) throw new Error('No organization context')
            yield eventsCollection.insert({
                id: newRecordId(),
                calendar: data.calendar,
                created_by: userOrg.id,
                title: data.title.trim(),
                description: data.description,
                location: data.location,
                start: combineDateAndTime(data.startDate, data.startTime),
                end: combineDateAndTime(data.endDate, data.endTime),
                all_day: data.all_day,
                recurrence: data.recurrence,
                guests: [],
                reminder: data.reminderMinutes,
                busy_status: data.busy_status,
                visibility: data.visibility,
                ical_uid: '',
            })
        }),
        onSuccess: navigateBack,
        onError: handleMutationErrorsWithForm({ setError, getValues }),
    })

    const updateEvent = useMutation({
        mutationFn: mutation(function* (data: z.infer<typeof eventSchema>) {
            yield eventsCollection.update(baseId, draft => {
                draft.title = data.title.trim()
                draft.description = data.description
                draft.location = data.location
                draft.start = combineDateAndTime(data.startDate, data.startTime)
                draft.end = combineDateAndTime(data.endDate, data.endTime)
                draft.all_day = data.all_day
                draft.recurrence = data.recurrence
                draft.calendar = data.calendar
                draft.reminder = data.reminderMinutes
                draft.busy_status = data.busy_status
                draft.visibility = data.visibility
            })
        }),
        onSuccess: navigateBack,
        onError: handleMutationErrorsWithForm({ setError, getValues }),
    })

    const isLoadingEvent = !isNew && !existingEvents
    const isNotFound = !isNew && existingEvents && !event
    const eventCalendar = event ? calendarMap.get(event.calendar) : undefined
    const isReadOnly = !!eventCalendar?.subscription_url

    if (!isNew && isReadOnly) {
        return (
            <View className="flex-1 items-center justify-center bg-background">
                <Text className="text-muted-foreground" style={{ fontSize: 16 }}>
                    Events from subscribed calendars cannot be edited
                </Text>
                <Pressable
                    onPress={navigateBack}
                    className="mt-3 px-3 py-1.5 rounded-md border"
                    style={{ borderColor: mutedColor }}
                >
                    <Text className="text-foreground" style={{ fontSize: 14 }}>
                        Go back
                    </Text>
                </Pressable>
            </View>
        )
    }

    if (isNotFound) {
        return (
            <View className="flex-1 items-center justify-center bg-background">
                <Text className="text-muted-foreground" style={{ fontSize: 16 }}>
                    Event not found
                </Text>
                <Pressable
                    onPress={navigateBack}
                    className="mt-3 px-3 py-1.5 rounded-md border"
                    style={{
                        borderColor: mutedColor,
                    }}
                >
                    <Text className="text-foreground" style={{ fontSize: 14 }}>
                        Go back
                    </Text>
                </Pressable>
            </View>
        )
    }

    const activeMutation = isNew ? createEvent : updateEvent
    const onSubmit = handleSubmit(data => activeMutation.mutate(data))
    const calendarValue = watch('calendar')
    // For new events, the calendar field is populated from defaultCalendar
    // once the live query resolves. Submitting before that yields a 400
    // because `calendar` is a required relation in the PB schema.
    const canSubmit = !activeMutation.isPending && !!userOrg && !isLoadingEvent && !!calendarValue

    const isDesktop = breakpoint === 'desktop'
    const guests = event?.guests ?? []

    const formContent = (
        <EventForm
            control={control}
            errors={errors}
            isSubmitted={isSubmitted}
            calendars={calendars}
            startDateValue={startDateValue}
        />
    )

    const guestContent = <EventGuestList guests={guests} />

    return (
        <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            className="flex-1 bg-background"
        >
            <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
                <View className="flex-1 p-5">
                    <View className="flex-row justify-between items-center mb-5">
                        <View className="flex-row gap-3 items-center">
                            <Pressable onPress={navigateBack}>
                                <ArrowLeft size={24} color={fgColor} />
                            </Pressable>
                            <Text
                                className="text-foreground"
                                style={{ fontSize: 24, fontWeight: 'bold' }}
                            >
                                {event ? 'Edit Event' : 'New Event'}
                            </Text>
                        </View>
                        <Button onPress={onSubmit} isDisabled={!canSubmit} size="sm">
                            <ButtonText>
                                {activeMutation.isPending ? 'Saving...' : 'Save'}
                            </ButtonText>
                        </Button>
                    </View>

                    {isDesktop ? (
                        <View className="flex-row gap-5 flex-1">
                            <View className="flex-[2]">{formContent}</View>
                            <View className="flex-1">{guestContent}</View>
                        </View>
                    ) : (
                        <View className="gap-4">
                            {formContent}
                            {guestContent}
                        </View>
                    )}
                </View>
            </ScrollView>
        </KeyboardAvoidingView>
    )
}
