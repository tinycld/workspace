import { useBreakpoint } from '@tinycld/core/components/workspace/useBreakpoint'
import { useWorkspaceStore } from '@tinycld/core/lib/stores/workspace-store'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Button, ButtonText } from '@tinycld/core/ui/button'
import { ChevronLeft, ChevronRight, Menu } from 'lucide-react-native'
import { Pressable, Text, View } from 'react-native'
import { formatDateLabel } from '../hooks/useCalendarNavigation'
import { useCalendarView, type ViewMode } from '../hooks/useCalendarView'

const DESKTOP_VIEW_MODES: ViewMode[] = ['day', 'week', 'month', 'schedule']
const VIEW_LABELS: Record<ViewMode, string> = {
    day: 'Day',
    week: 'Week',
    month: 'Month',
    schedule: 'Schedule',
}

export function CalendarHeader() {
    const { viewMode, setViewMode, focusDate, goToday, goNext, goPrevious } = useCalendarView()
    const fgColor = useThemeColor('foreground')
    const breakpoint = useBreakpoint()
    const isMobile = breakpoint === 'mobile'
    const setDrawerOpen = useWorkspaceStore((s) => s.setDrawerOpen)

    const dateLabel = formatDateLabel(focusDate, viewMode)

    if (isMobile) {
        return (
            <View className="flex-row items-center px-3 py-2 gap-2">
                <Pressable
                    testID="drawer-toggle"
                    onPress={() => setDrawerOpen(true)}
                    hitSlop={8}
                >
                    <Menu size={22} color={fgColor} />
                </Pressable>

                <Text style={{ fontSize: 18, fontWeight: '600', color: fgColor }}>{dateLabel}</Text>

                <View className="flex-1" />

                <Button onPress={goToday} variant="outline" size="sm">
                    <ButtonText>Today</ButtonText>
                </Button>

                <Pressable onPress={goPrevious} hitSlop={8}>
                    <ChevronLeft size={20} color={fgColor} />
                </Pressable>
                <Pressable onPress={goNext} hitSlop={8}>
                    <ChevronRight size={20} color={fgColor} />
                </Pressable>
            </View>
        )
    }

    return (
        <View className="flex-row items-center px-4 py-2 gap-2">
            <Button onPress={goToday} variant="outline" size="sm">
                <ButtonText>Today</ButtonText>
            </Button>

            <Pressable onPress={goPrevious} hitSlop={8}>
                <ChevronLeft size={20} color={fgColor} />
            </Pressable>
            <Pressable onPress={goNext} hitSlop={8}>
                <ChevronRight size={20} color={fgColor} />
            </Pressable>

            <Text style={{ fontSize: 20, fontWeight: '600', color: fgColor, flex: 1 }}>{dateLabel}</Text>

            <View className="flex-row border border-border rounded-md overflow-hidden">
                {DESKTOP_VIEW_MODES.map((mode, i) => (
                    <ViewModeSegment
                        key={mode}
                        mode={mode}
                        isActive={viewMode === mode}
                        isFirst={i === 0}
                        onPress={() => setViewMode(mode)}
                    />
                ))}
            </View>
        </View>
    )
}

// Segmented control item — built on Pressable directly with theme-token
// classes so the active and hover states stay readable in both themes.
// The gluestack ghost variant re-applies its own hover background, which
// would mask the active fill and leave white text on a near-transparent
// tint.
function ViewModeSegment({
    mode,
    isActive,
    isFirst,
    onPress,
}: {
    mode: ViewMode
    isActive: boolean
    isFirst: boolean
    onPress: () => void
}) {
    const bgClass = isActive ? 'bg-active-indicator/15' : 'hover:bg-hover-background'
    const borderClass = isFirst ? '' : 'border-l border-border'
    const textClass = isActive ? 'text-foreground font-semibold' : 'text-muted-foreground'

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={VIEW_LABELS[mode]}
            onPress={onPress}
            className={`px-3 py-1.5 ${borderClass} ${bgClass}`}
        >
            <Text className={textClass} style={{ fontSize: 14 }}>
                {VIEW_LABELS[mode]}
            </Text>
        </Pressable>
    )
}
