import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { AlertTriangle, Check, ChevronDown, ChevronRight } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import type { CalendarColorKey, CalendarWithGroup } from '../types'
import { CalendarMenu } from './CalendarMenu'
import { getCalendarColorResolved } from './calendar-colors'

interface CalendarListProps {
    calendars: CalendarWithGroup[]
    visibleIds: Set<string>
    onToggle: (id: string) => void
    onColorChange: (calendarId: string, color: CalendarColorKey) => void
    onShowOnly: (calendarId: string) => void
    onRefreshSubscription?: (calendarId: string) => void
    onDeleteCalendar?: (calendarId: string) => void
    /** Called when the user picks "Settings & sharing" on a calendar.
     *  Caller decides whether to expose this per-calendar (e.g. only owners). */
    onOpenSettings?: (calendarId: string) => void
}

function CalendarCheckbox({
    calendar,
    isChecked,
    onToggle,
    onColorChange,
    onShowOnly,
    onRefreshSubscription,
    onDeleteCalendar,
    onOpenSettings,
}: {
    calendar: CalendarWithGroup
    isChecked: boolean
    onToggle: (id: string) => void
    onColorChange: (calendarId: string, color: CalendarColorKey) => void
    onShowOnly: (calendarId: string) => void
    onRefreshSubscription?: (calendarId: string) => void
    onDeleteCalendar?: (calendarId: string) => void
    onOpenSettings?: (calendarId: string) => void
}) {
    const dangerColor = useThemeColor('danger')
    const colors = getCalendarColorResolved(calendar.color)

    return (
        <View>
            <View className="flex-row items-center pr-3 py-[5px]">
                <Pressable
                    className="flex-row items-center gap-2.5 flex-1"
                    style={{ paddingLeft: 20 }}
                    onPress={() => onToggle(calendar.id)}
                >
                    <View
                        className="items-center justify-center"
                        style={{
                            width: 16,
                            height: 16,
                            borderRadius: 3,
                            backgroundColor: isChecked ? colors.bg : 'transparent',
                            borderColor: colors.bg,
                            borderWidth: isChecked ? 0 : 2,
                        }}
                    >
                        {isChecked && <Check size={12} color={colors.text} />}
                    </View>
                    <Text className="flex-1 text-foreground" style={{ fontSize: 15 }} numberOfLines={1}>
                        {calendar.name}
                    </Text>
                    {calendar.subscription_error ? <AlertTriangle size={14} color={dangerColor} /> : null}
                </Pressable>
                <CalendarMenu
                    currentColor={calendar.color}
                    onColorChange={(color) => onColorChange(calendar.id, color)}
                    onShowOnly={() => onShowOnly(calendar.id)}
                    calendar={calendar}
                    onRefresh={onRefreshSubscription ? () => onRefreshSubscription(calendar.id) : undefined}
                    onDelete={onDeleteCalendar ? () => onDeleteCalendar(calendar.id) : undefined}
                    onOpenSettings={onOpenSettings ? () => onOpenSettings(calendar.id) : undefined}
                />
            </View>
            {calendar.subscription_error ? (
                <Text
                    className="text-danger"
                    style={{ fontSize: 11, paddingLeft: 60, paddingRight: 12 }}
                    numberOfLines={2}
                >
                    {calendar.subscription_error}
                </Text>
            ) : null}
        </View>
    )
}

function CalendarSection({
    title,
    calendars,
    visibleIds,
    onToggle,
    onColorChange,
    onShowOnly,
    onRefreshSubscription,
    onDeleteCalendar,
    onOpenSettings,
}: {
    title: string
    calendars: CalendarWithGroup[]
    visibleIds: Set<string>
    onToggle: (id: string) => void
    onColorChange: (calendarId: string, color: CalendarColorKey) => void
    onShowOnly: (calendarId: string) => void
    onRefreshSubscription?: (calendarId: string) => void
    onDeleteCalendar?: (calendarId: string) => void
    onOpenSettings?: (calendarId: string) => void
}) {
    const [expanded, setExpanded] = useState(true)
    const mutedColor = useThemeColor('muted-foreground')
    const ChevronIcon = expanded ? ChevronDown : ChevronRight

    return (
        <View>
            <Pressable
                className="flex-row items-center gap-1.5 px-3 py-1.5"
                onPress={() => setExpanded((prev) => !prev)}
            >
                <ChevronIcon size={14} color={mutedColor} />
                <Text style={{ fontSize: 13, fontWeight: '600', color: mutedColor }}>{title}</Text>
            </Pressable>
            {expanded &&
                calendars.map((cal) => (
                    <CalendarCheckbox
                        key={cal.id}
                        calendar={cal}
                        isChecked={visibleIds.has(cal.id)}
                        onToggle={onToggle}
                        onColorChange={onColorChange}
                        onShowOnly={onShowOnly}
                        onRefreshSubscription={onRefreshSubscription}
                        onDeleteCalendar={onDeleteCalendar}
                        onOpenSettings={onOpenSettings}
                    />
                ))}
        </View>
    )
}

export function CalendarList({
    calendars,
    visibleIds,
    onToggle,
    onColorChange,
    onShowOnly,
    onRefreshSubscription,
    onDeleteCalendar,
    onOpenSettings,
}: CalendarListProps) {
    const mine = calendars.filter((c) => c.group === 'mine')
    const other = calendars.filter((c) => c.group === 'other')
    const subscribed = calendars.filter((c) => c.group === 'subscribed')

    return (
        <View className="gap-1">
            <CalendarSection
                title="My calendars"
                calendars={mine}
                visibleIds={visibleIds}
                onToggle={onToggle}
                onColorChange={onColorChange}
                onShowOnly={onShowOnly}
                onDeleteCalendar={onDeleteCalendar}
                onOpenSettings={onOpenSettings}
            />
            <CalendarSection
                title="Other calendars"
                calendars={other}
                visibleIds={visibleIds}
                onToggle={onToggle}
                onColorChange={onColorChange}
                onShowOnly={onShowOnly}
                onDeleteCalendar={onDeleteCalendar}
                onOpenSettings={onOpenSettings}
            />
            {subscribed.length > 0 && (
                <CalendarSection
                    title="Subscribed calendars"
                    calendars={subscribed}
                    visibleIds={visibleIds}
                    onToggle={onToggle}
                    onColorChange={onColorChange}
                    onShowOnly={onShowOnly}
                    onRefreshSubscription={onRefreshSubscription}
                    onDeleteCalendar={onDeleteCalendar}
                    onOpenSettings={onOpenSettings}
                />
            )}
        </View>
    )
}
