import { SuretyGuard } from '@tinycld/core/components/SuretyGuard'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Menu, Separator } from '@tinycld/core/ui/menu'
import * as Clipboard from 'expo-clipboard'
import { Check, MoreVertical } from 'lucide-react-native'
import { Pressable, Text, View } from 'react-native'
import type { CalendarColorKey, CalendarWithGroup } from '../types'
import { CALENDAR_COLOR_GRID, getCalendarColorResolved } from './calendar-colors'

interface CalendarMenuProps {
    currentColor: CalendarColorKey
    onColorChange: (color: CalendarColorKey) => void
    onShowOnly: () => void
    calendar?: CalendarWithGroup
    onRefresh?: () => void
    onDelete?: () => void
    /** When provided, renders a "Settings & sharing" item. Caller decides
     *  whether the current user can manage this calendar. */
    onOpenSettings?: () => void
}

function formatLastSync(dateStr: string): string {
    if (!dateStr) return 'Never'
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    const diffHours = Math.floor(diffMins / 60)
    if (diffHours < 24) return `${diffHours}h ago`
    return `${Math.floor(diffHours / 24)}d ago`
}

export function CalendarMenu({
    currentColor,
    onColorChange,
    onShowOnly,
    calendar,
    onRefresh,
    onDelete,
    onOpenSettings,
}: CalendarMenuProps) {
    const mutedColor = useThemeColor('muted-foreground')
    const dangerColor = useThemeColor('danger')
    const isSubscribed = !!calendar?.subscription_url

    const deleteLabel = isSubscribed ? 'Remove subscription' : 'Delete calendar'
    const deleteMessage = isSubscribed
        ? `Remove "${calendar?.name}" subscription? This will remove the calendar and all its events.`
        : `Delete "${calendar?.name}"? This will permanently remove the calendar and all its events.`

    return (
        <SuretyGuard message={deleteMessage} confirmLabel={deleteLabel} onConfirmed={() => onDelete?.()}>
            {(onConfirmOpen) => (
                <Menu>
                    <Menu.Trigger>
                        <Pressable className="p-1 rounded" hitSlop={8}>
                            <MoreVertical size={14} color={mutedColor} />
                        </Pressable>
                    </Menu.Trigger>
                    <Menu.Portal>
                        <Menu.Overlay />
                        <Menu.Content presentation="popover" placement="bottom" align="start">
                            <Menu.Item onPress={onShowOnly}>
                                <Menu.ItemTitle>Display this only</Menu.ItemTitle>
                            </Menu.Item>

                            {onOpenSettings && (
                                <Menu.Item onPress={onOpenSettings}>
                                    <Menu.ItemTitle>Settings &amp; sharing</Menu.ItemTitle>
                                </Menu.Item>
                            )}

                            {isSubscribed && (
                                <>
                                    <Separator />
                                    {calendar.subscription_last_sync ? (
                                        <View className="px-3 py-1.5">
                                            <Text style={{ fontSize: 11, color: mutedColor }}>
                                                Synced {formatLastSync(calendar.subscription_last_sync)}
                                            </Text>
                                        </View>
                                    ) : null}
                                    {calendar.subscription_error ? (
                                        <View className="px-3 py-1.5">
                                            <Text style={{ fontSize: 11, color: dangerColor }} numberOfLines={2}>
                                                {calendar.subscription_error}
                                            </Text>
                                        </View>
                                    ) : null}
                                    <Menu.Item onPress={onRefresh}>
                                        <Menu.ItemTitle>Refresh now</Menu.ItemTitle>
                                    </Menu.Item>
                                    <Menu.Item onPress={() => Clipboard.setStringAsync(calendar.subscription_url)}>
                                        <Menu.ItemTitle>Copy URL</Menu.ItemTitle>
                                    </Menu.Item>
                                </>
                            )}

                            <Separator />

                            <View className="px-3 py-2 gap-1.5">
                                {CALENDAR_COLOR_GRID.map((row) => (
                                    <View key={row.join('-')} className="flex-row gap-1.5">
                                        {row.map((colorKey) => {
                                            const { bg } = getCalendarColorResolved(colorKey)
                                            return (
                                                <Pressable
                                                    key={colorKey}
                                                    onPress={() => onColorChange(colorKey)}
                                                    className="p-0.5 rounded-full size-7 items-center justify-center"
                                                >
                                                    <View
                                                        className="size-6 rounded-full items-center justify-center"
                                                        style={{
                                                            backgroundColor: bg,
                                                        }}
                                                    >
                                                        {currentColor === colorKey && (
                                                            <Check size={12} color="#ffffff" />
                                                        )}
                                                    </View>
                                                </Pressable>
                                            )
                                        })}
                                    </View>
                                ))}
                            </View>

                            {onDelete && (
                                <>
                                    <Separator />
                                    <Menu.Item onPress={onConfirmOpen}>
                                        <Menu.ItemTitle>{deleteLabel}</Menu.ItemTitle>
                                    </Menu.Item>
                                </>
                            )}
                        </Menu.Content>
                    </Menu.Portal>
                </Menu>
            )}
        </SuretyGuard>
    )
}
