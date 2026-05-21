import { useBreakpoint } from '@tinycld/core/components/workspace/useBreakpoint'
import { captureException } from '@tinycld/core/lib/errors'
import { mutation, useMutation } from '@tinycld/core/lib/mutations'
import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useCurrentUserOrg } from '@tinycld/core/lib/use-current-user-org'
import { useOrgInfo } from '@tinycld/core/lib/use-org-info'
import {
    Actionsheet,
    ActionsheetBackdrop,
    ActionsheetContent,
    ActionsheetDragIndicator,
    ActionsheetDragIndicatorWrapper,
} from '@tinycld/core/ui/actionsheet'
import { Button, ButtonText } from '@tinycld/core/ui/button'
import { TextInput, useForm, z, zodResolver } from '@tinycld/core/ui/form'
import { useRouter } from 'expo-router'
import { Users, X } from 'lucide-react-native'
import { newRecordId } from 'pbtsdb/core'
import { Pressable, Text, View } from 'react-native'
import { useVisibleCalendars } from '../hooks/useCalendarEvents'
import { getTimeLabel } from '../hooks/useCalendarNavigation'

const quickCreateSchema = z.object({
    title: z.string().min(1, 'Title is required'),
})

interface EventQuickCreateProps {
    isVisible: boolean
    initialDate: Date
    initialHour: number
    onClose: () => void
}

export function EventQuickCreate({ isVisible, initialDate, initialHour, onClose }: EventQuickCreateProps) {
    const isMobile = useBreakpoint() === 'mobile'

    if (isMobile) {
        return (
            <MobileQuickCreate
                isVisible={isVisible}
                initialDate={initialDate}
                initialHour={initialHour}
                onClose={onClose}
            />
        )
    }

    return (
        <DesktopQuickCreate
            isVisible={isVisible}
            initialDate={initialDate}
            initialHour={initialHour}
            onClose={onClose}
        />
    )
}

function useQuickCreateForm(initialDate: Date, initialHour: number, onClose: () => void) {
    const { orgSlug } = useOrgInfo()
    const userOrg = useCurrentUserOrg(orgSlug)
    const { mineCalendars, calendars } = useVisibleCalendars()
    const [eventsCollection] = useStore('calendar_events')

    const { control, handleSubmit, reset } = useForm({
        mode: 'onChange',
        resolver: zodResolver(quickCreateSchema),
        defaultValues: { title: '' },
    })

    const createEvent = useMutation({
        mutationFn: mutation(function* (data: z.infer<typeof quickCreateSchema>) {
            if (!userOrg) throw new Error('No organization context')
            const defaultCalendar = mineCalendars[0] ?? calendars[0]
            if (!defaultCalendar) throw new Error('No calendar available')

            const startDate = new Date(initialDate)
            startDate.setHours(initialHour, 0, 0, 0)
            const endDate = new Date(initialDate)
            endDate.setHours(initialHour + 1, 0, 0, 0)

            yield eventsCollection.insert({
                id: newRecordId(),
                calendar: defaultCalendar.id,
                created_by: userOrg.id,
                title: data.title,
                start: startDate.toISOString(),
                end: endDate.toISOString(),
                all_day: false,
                description: '',
                location: '',
                recurrence: '',
                guests: [],
                reminder: 30,
                busy_status: 'busy',
                visibility: 'default',
                ical_uid: '',
            })
        }),
        onSuccess: () => {
            reset()
            onClose()
        },
        onError: (error) => captureException('EventQuickCreate', error),
    })

    const dayLabel = initialDate.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
    })
    const endHour = (initialHour + 1) % 24
    const timeLabel = `${getTimeLabel(initialHour)} – ${getTimeLabel(endHour)}`

    const onSave = handleSubmit((data) => createEvent.mutate(data))

    return { control, onSave, dayLabel, timeLabel }
}

function MobileQuickCreate({ isVisible, initialDate, initialHour, onClose }: EventQuickCreateProps) {
    const mutedColor = useThemeColor('muted-foreground')
    const router = useRouter()
    const orgHref = useOrgHref()
    const { control, onSave, dayLabel, timeLabel } = useQuickCreateForm(initialDate, initialHour, onClose)

    const onMoreOptions = () => {
        onClose()
        router.push(orgHref('calendar/[id]', { id: 'new' }))
    }

    return (
        <Actionsheet isOpen={isVisible} onClose={onClose}>
            <ActionsheetBackdrop />
            <ActionsheetContent>
                <ActionsheetDragIndicatorWrapper>
                    <ActionsheetDragIndicator />
                </ActionsheetDragIndicatorWrapper>
                <View className="p-5 gap-3 w-full">
                    <View className="flex-row justify-between items-center">
                        <Pressable onPress={onClose}>
                            <Text className="text-muted-foreground" style={{ fontSize: 14 }}>
                                Cancel
                            </Text>
                        </Pressable>
                        <Button onPress={onSave} size="sm">
                            <ButtonText>Save</ButtonText>
                        </Button>
                    </View>

                    <TextInput control={control} name="title" placeholder="Add title" autoFocus />

                    <View className="gap-1">
                        <Text className="text-muted-foreground" style={{ fontSize: 12 }}>
                            {dayLabel}
                        </Text>
                        <Text className="text-muted-foreground" style={{ fontSize: 12 }}>
                            {timeLabel}
                        </Text>
                    </View>

                    <Pressable className="flex-row items-center gap-2.5 py-2" onPress={onMoreOptions}>
                        <Users size={18} color={mutedColor} />
                        <Text className="text-muted-foreground" style={{ fontSize: 14 }}>
                            Add guests
                        </Text>
                    </Pressable>
                </View>
            </ActionsheetContent>
        </Actionsheet>
    )
}

function DesktopQuickCreate({ isVisible, initialDate, initialHour, onClose }: EventQuickCreateProps) {
    const mutedColor = useThemeColor('muted-foreground')
    const shadowColor = useThemeColor('overlay-backdrop')
    const router = useRouter()
    const orgHref = useOrgHref()
    const { control, onSave, dayLabel, timeLabel } = useQuickCreateForm(initialDate, initialHour, onClose)

    if (!isVisible) return null

    const onMoreOptions = () => {
        onClose()
        router.push(orgHref('calendar/[id]', { id: 'new' }))
    }

    return (
        <Pressable
            className="absolute top-0 left-0 right-0 bottom-0 justify-center items-center z-[100]"
            onPress={onClose}
        >
            <Pressable
                className="w-[340px] rounded-xl border border-border bg-background p-4"
                style={{
                    shadowColor,
                    shadowOffset: { width: 0, height: 4 },
                    shadowOpacity: 0.15,
                    shadowRadius: 12,
                    elevation: 8,
                }}
                onPress={(e) => e.stopPropagation()}
            >
                <View className="flex-row justify-between items-center">
                    <Text className="text-foreground" style={{ fontSize: 16, fontWeight: '600' }}>
                        New Event
                    </Text>
                    <Pressable onPress={onClose} hitSlop={8}>
                        <X size={18} color={mutedColor} />
                    </Pressable>
                </View>

                <View className="gap-3 py-2">
                    <TextInput control={control} name="title" placeholder="Add title" autoFocus />

                    <View className="gap-1">
                        <Text className="text-muted-foreground" style={{ fontSize: 12 }}>
                            {dayLabel}
                        </Text>
                        <Text className="text-muted-foreground" style={{ fontSize: 12 }}>
                            {timeLabel}
                        </Text>
                    </View>
                </View>

                <View className="flex-row justify-between items-center mt-2">
                    <Pressable onPress={onMoreOptions}>
                        <Text className="text-primary" style={{ fontSize: 12 }}>
                            More options
                        </Text>
                    </Pressable>
                    <Button onPress={onSave} size="sm">
                        <ButtonText>Save</ButtonText>
                    </Button>
                </View>
            </Pressable>
        </Pressable>
    )
}
