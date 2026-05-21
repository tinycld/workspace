import { useBreakpoint } from '@tinycld/core/components/workspace/useBreakpoint'
import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useRouter } from 'expo-router'
import { Clock, MapPin, Pencil, Trash2, Users, X } from 'lucide-react-native'
import { useLayoutEffect, useRef, useState } from 'react'
import { Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native'
import type { AnchorRect } from '../hooks/useCalendarView'
import { describeRRule, parseEventId } from '../lib/recurrence'
import type { CalendarEvents } from '../types'
import { getCalendarColorResolved } from './calendar-colors'
import { EventGuestList } from './EventGuestList'

interface EventDetailPopoverProps {
    isVisible: boolean
    event: CalendarEvents | undefined
    calendarName: string
    calendarColorKey: string
    anchorRect?: AnchorRect
    onClose: () => void
    onDelete?: (eventId: string) => void
    isReadOnly?: boolean
}

function formatEventDateTime(event: CalendarEvents): string {
    const start = new Date(event.start)
    const end = new Date(event.end)
    if (event.all_day) {
        return start.toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
        })
    }
    const dateStr = start.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
    })
    const startTime = start.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
    })
    const endTime = end.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
    })
    return `${dateStr}\n${startTime} – ${endTime}`
}

function getRecurrenceLabel(event: CalendarEvents): string {
    if (!event.recurrence) return ''
    const eventStart = new Date(event.start)
    return describeRRule(event.recurrence, eventStart)
}

function MobileEventDetail({
    event,
    calendarName,
    calendarColorKey,
    onClose,
    onDelete,
    isReadOnly,
}: Omit<EventDetailPopoverProps, 'isVisible'> & { event: CalendarEvents }) {
    const fgColor = useThemeColor('foreground')
    const mutedColor = useThemeColor('muted-foreground')
    const router = useRouter()
    const orgHref = useOrgHref()
    const colors = getCalendarColorResolved(calendarColorKey)
    const dateTimeStr = formatEventDateTime(event)

    const { baseId } = parseEventId(event.id)
    const onEdit = () => {
        onClose()
        router.push(orgHref('calendar/[id]', { id: baseId }))
    }

    return (
        <View className="flex-1 bg-background">
            <View className="flex-row justify-between items-center px-4 py-3">
                <Pressable onPress={onClose} hitSlop={8}>
                    <X size={22} color={fgColor} />
                </Pressable>
                {!isReadOnly && (
                    <View className="flex-row gap-5">
                        <Pressable onPress={onEdit} hitSlop={8}>
                            <Pencil size={20} color={mutedColor} />
                        </Pressable>
                        <Pressable
                            hitSlop={8}
                            onPress={() => {
                                onDelete?.(baseId)
                                onClose()
                            }}
                        >
                            <Trash2 size={20} color={mutedColor} />
                        </Pressable>
                    </View>
                )}
            </View>

            <ScrollView className="flex-1" contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}>
                <View className="flex-row items-center gap-3 mb-5">
                    <View
                        className="size-4 rounded-lg"
                        style={{
                            backgroundColor: colors.bg,
                        }}
                    />
                    <Text className="flex-1 text-foreground" style={{ fontSize: 22, fontWeight: '700' }}>
                        {event.title}
                    </Text>
                </View>

                <View className="flex-row items-start gap-3 mb-3">
                    <Clock size={18} color={mutedColor} />
                    <Text className="flex-1 text-foreground" style={{ fontSize: 15 }}>
                        {dateTimeStr}
                    </Text>
                </View>

                {event.recurrence ? (
                    <Text
                        className="text-muted-foreground"
                        style={{
                            fontSize: 14,
                            marginBottom: 12,
                            paddingLeft: 30,
                        }}
                    >
                        {getRecurrenceLabel(event)}
                    </Text>
                ) : null}

                {event.location ? (
                    <View className="flex-row items-start gap-3 mb-3">
                        <MapPin size={18} color={mutedColor} />
                        <Text className="flex-1 text-foreground" style={{ fontSize: 15 }}>
                            {event.location}
                        </Text>
                    </View>
                ) : null}

                {event.guests.length > 0 ? (
                    <View className="mb-2">
                        <View className="flex-row items-start gap-3 mb-3">
                            <Users size={18} color={mutedColor} />
                            <Text className="flex-1 text-foreground" style={{ fontSize: 15 }}>
                                {event.guests.length} guest
                                {event.guests.length !== 1 ? 's' : ''}
                            </Text>
                        </View>
                        <EventGuestList guests={event.guests} />
                    </View>
                ) : null}

                {event.description ? (
                    <Text
                        className="text-foreground"
                        style={{
                            fontSize: 15,
                            marginTop: 8,
                            marginBottom: 12,
                            lineHeight: 22,
                        }}
                    >
                        {event.description}
                    </Text>
                ) : null}

                <Text className="text-muted-foreground" style={{ fontSize: 13, marginTop: 16 }}>
                    {calendarName}
                </Text>
            </ScrollView>
        </View>
    )
}

const POPOVER_WIDTH = 360
const ARROW_SIZE = 8
const POPOVER_MARGIN = 12

type ArrowSide = 'left' | 'right' | 'top' | 'bottom'

function usePopoverPosition(anchorRect: AnchorRect | undefined) {
    const { width: winW, height: winH } = useWindowDimensions()
    const popoverRef = useRef<View>(null)
    const [popoverHeight, setPopoverHeight] = useState(300)

    useLayoutEffect(() => {
        if (popoverRef.current) {
            const node = popoverRef.current as unknown as Element
            if ('getBoundingClientRect' in node) {
                const rect = node.getBoundingClientRect()
                if (rect.height > 0) setPopoverHeight(rect.height)
            }
        }
    })

    if (!anchorRect) {
        return {
            popoverRef,
            position: { top: winH / 2 - popoverHeight / 2, left: winW / 2 - POPOVER_WIDTH / 2 },
            arrowSide: 'left' as ArrowSide,
            arrowOffset: popoverHeight / 2 - ARROW_SIZE,
        }
    }

    const anchorCenterY = anchorRect.y + anchorRect.height / 2

    const spaceRight = winW - anchorRect.x - anchorRect.width
    const spaceLeft = anchorRect.x

    let arrowSide: ArrowSide
    let left: number
    if (spaceRight >= POPOVER_WIDTH + POPOVER_MARGIN + ARROW_SIZE) {
        arrowSide = 'left'
        left = anchorRect.x + anchorRect.width + POPOVER_MARGIN
    } else if (spaceLeft >= POPOVER_WIDTH + POPOVER_MARGIN + ARROW_SIZE) {
        arrowSide = 'right'
        left = anchorRect.x - POPOVER_WIDTH - POPOVER_MARGIN
    } else {
        arrowSide = 'left'
        left = Math.max(
            POPOVER_MARGIN,
            Math.min(winW - POPOVER_WIDTH - POPOVER_MARGIN, anchorRect.x + anchorRect.width + POPOVER_MARGIN)
        )
    }

    let top = anchorCenterY - popoverHeight / 2
    top = Math.max(POPOVER_MARGIN, Math.min(winH - popoverHeight - POPOVER_MARGIN, top))

    const arrowOffset = Math.max(ARROW_SIZE + 4, Math.min(popoverHeight - ARROW_SIZE - 4, anchorCenterY - top))

    return { popoverRef, position: { top, left }, arrowSide, arrowOffset }
}

export function EventDetailPopover({
    isVisible,
    event,
    calendarName,
    calendarColorKey,
    anchorRect,
    onClose,
    onDelete,
    isReadOnly,
}: EventDetailPopoverProps) {
    const mutedColor = useThemeColor('muted-foreground')
    const bgColor = useThemeColor('background')
    const borderColor = useThemeColor('border')
    const shadowColor = useThemeColor('overlay-backdrop')
    const router = useRouter()
    const orgHref = useOrgHref()
    const isMobile = useBreakpoint() === 'mobile'
    const { popoverRef, position, arrowSide, arrowOffset } = usePopoverPosition(isVisible ? anchorRect : undefined)

    if (!isVisible || !event) return null

    if (isMobile) {
        return (
            <View
                style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    zIndex: 100,
                }}
            >
                <MobileEventDetail
                    event={event}
                    calendarName={calendarName}
                    calendarColorKey={calendarColorKey}
                    onClose={onClose}
                    onDelete={onDelete}
                />
            </View>
        )
    }

    const colors = getCalendarColorResolved(calendarColorKey)
    const dateTimeStr = formatEventDateTime(event)
    const { baseId: desktopBaseId } = parseEventId(event.id)

    const onEdit = () => {
        onClose()
        router.push(orgHref('calendar/[id]', { id: desktopBaseId }))
    }

    const handleDelete = () => {
        onDelete?.(parseEventId(event.id).baseId)
        onClose()
    }

    const arrowBorderColor = borderColor
    const arrowBgColor = bgColor

    const arrowStyle =
        arrowSide === 'left'
            ? {
                  left: -ARROW_SIZE,
                  top: arrowOffset - ARROW_SIZE,
                  borderRightWidth: ARROW_SIZE,
                  borderRightColor: arrowBgColor,
                  borderTopWidth: ARROW_SIZE,
                  borderTopColor: 'transparent',
                  borderBottomWidth: ARROW_SIZE,
                  borderBottomColor: 'transparent',
              }
            : {
                  right: -ARROW_SIZE,
                  top: arrowOffset - ARROW_SIZE,
                  borderLeftWidth: ARROW_SIZE,
                  borderLeftColor: arrowBgColor,
                  borderTopWidth: ARROW_SIZE,
                  borderTopColor: 'transparent',
                  borderBottomWidth: ARROW_SIZE,
                  borderBottomColor: 'transparent',
              }

    const arrowBorderStyle =
        arrowSide === 'left'
            ? {
                  left: -ARROW_SIZE - 1,
                  top: arrowOffset - ARROW_SIZE - 1,
                  borderRightWidth: ARROW_SIZE + 1,
                  borderRightColor: arrowBorderColor,
                  borderTopWidth: ARROW_SIZE + 1,
                  borderTopColor: 'transparent',
                  borderBottomWidth: ARROW_SIZE + 1,
                  borderBottomColor: 'transparent',
              }
            : {
                  right: -ARROW_SIZE - 1,
                  top: arrowOffset - ARROW_SIZE - 1,
                  borderLeftWidth: ARROW_SIZE + 1,
                  borderLeftColor: arrowBorderColor,
                  borderTopWidth: ARROW_SIZE + 1,
                  borderTopColor: 'transparent',
                  borderBottomWidth: ARROW_SIZE + 1,
                  borderBottomColor: 'transparent',
              }

    return (
        <Pressable
            style={{
                position: 'fixed' as 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: 100,
            }}
            onPress={onClose}
        >
            <View
                ref={popoverRef}
                className="absolute border border-border bg-background"
                style={{
                    width: POPOVER_WIDTH,
                    borderRadius: 12,
                    padding: 16,
                    shadowColor,
                    shadowOffset: { width: 0, height: 4 },
                    shadowOpacity: 0.15,
                    shadowRadius: 12,
                    elevation: 8,
                    top: position.top,
                    left: position.left,
                }}
                onStartShouldSetResponder={() => true}
                onResponderRelease={(e) => e.stopPropagation()}
            >
                <Pressable onPress={(e) => e.stopPropagation()} className="flex-1">
                    {anchorRect ? (
                        <>
                            <View
                                style={{
                                    position: 'absolute',
                                    width: 0,
                                    height: 0,
                                    borderStyle: 'solid',
                                    ...arrowBorderStyle,
                                }}
                            />
                            <View
                                style={{
                                    position: 'absolute',
                                    width: 0,
                                    height: 0,
                                    borderStyle: 'solid',
                                    ...arrowStyle,
                                }}
                            />
                        </>
                    ) : null}

                    <View className="flex-row justify-end gap-4 mb-3">
                        {!isReadOnly && (
                            <>
                                <Pressable onPress={onEdit} hitSlop={8}>
                                    <Pencil size={18} color={mutedColor} />
                                </Pressable>
                                <Pressable onPress={handleDelete} hitSlop={8}>
                                    <Trash2 size={18} color={mutedColor} />
                                </Pressable>
                            </>
                        )}
                        <Pressable onPress={onClose} hitSlop={8}>
                            <X size={18} color={mutedColor} />
                        </Pressable>
                    </View>

                    <View className="flex-row items-center gap-2.5 mb-3">
                        <View
                            className="w-1 h-6 rounded-sm"
                            style={{
                                backgroundColor: colors.bg,
                            }}
                        />
                        <Text className="flex-1 text-foreground" style={{ fontSize: 18, fontWeight: '600' }}>
                            {event.title}
                        </Text>
                    </View>

                    <View className="flex-row items-start gap-2.5 mb-2 pl-0.5">
                        <Clock size={16} color={mutedColor} />
                        <Text className="flex-1 text-foreground" style={{ fontSize: 14 }}>
                            {dateTimeStr}
                        </Text>
                    </View>

                    {event.recurrence ? (
                        <Text
                            className="text-muted-foreground"
                            style={{
                                fontSize: 13,
                                marginBottom: 8,
                                paddingLeft: 22,
                            }}
                        >
                            {getRecurrenceLabel(event)}
                        </Text>
                    ) : null}

                    {event.location ? (
                        <View className="flex-row items-start gap-2.5 mb-2 pl-0.5">
                            <MapPin size={16} color={mutedColor} />
                            <Text className="flex-1 text-foreground" style={{ fontSize: 14 }}>
                                {event.location}
                            </Text>
                        </View>
                    ) : null}

                    {event.guests.length > 0 ? (
                        <View className="flex-row items-start gap-2.5 mb-2 pl-0.5">
                            <Users size={16} color={mutedColor} />
                            <Text className="flex-1 text-foreground" style={{ fontSize: 14 }}>
                                {event.guests.length} guest{event.guests.length !== 1 ? 's' : ''}
                            </Text>
                        </View>
                    ) : null}

                    {event.description ? (
                        <Text
                            className="mt-1 mb-2 pl-0.5 text-muted-foreground"
                            style={{ fontSize: 13 }}
                            numberOfLines={3}
                        >
                            {event.description}
                        </Text>
                    ) : null}

                    <Text className="mt-2 pl-0.5 text-muted-foreground" style={{ fontSize: 12 }}>
                        {calendarName}
                    </Text>
                </Pressable>
            </View>
        </Pressable>
    )
}
