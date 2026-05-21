import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { PlainInput } from '@tinycld/core/ui/PlainInput'
import { Menu, Search, SlidersHorizontal } from 'lucide-react-native'
import { Pressable, View } from 'react-native'
import type { AdvancedSearchFilters } from '../hooks/useSearchState'
import { AdvancedSearchDropdown } from './AdvancedSearchDropdown'

interface SearchBarProps {
    value: string
    onChangeText: (text: string) => void
    onMenuPress?: () => void
    isFilterOpen: boolean
    onFilterOpenChange: (open: boolean) => void
    onApplyFilters: (filters: AdvancedSearchFilters) => void
    activeFilterCount: number
    currentFilters: AdvancedSearchFilters
}

export function SearchBar({
    value,
    onChangeText,
    onMenuPress,
    isFilterOpen,
    onFilterOpenChange,
    onApplyFilters,
    activeFilterCount,
    currentFilters,
}: SearchBarProps) {
    const foregroundColor = useThemeColor('foreground')
    const mutedColor = useThemeColor('muted-foreground')
    const primaryColor = useThemeColor('primary')
    const placeholderColor = useThemeColor('field-placeholder')
    const hasActiveFilters = activeFilterCount > 0
    const filterIconColor = hasActiveFilters ? primaryColor : mutedColor

    return (
        <View className="relative" style={{ zIndex: 100 }}>
            <View className="flex-row items-center h-[44px] rounded-[22px] px-4 gap-2.5 border border-border bg-surface-secondary">
                {onMenuPress ? (
                    <Pressable
                        testID="drawer-toggle"
                        onPress={onMenuPress}
                        className="p-0.5"
                    >
                        <Menu size={20} color={mutedColor} />
                    </Pressable>
                ) : null}
                <Search size={18} color={mutedColor} />
                <PlainInput
                    className="flex-1"
                    style={{ fontSize: 15, color: foregroundColor }}
                    placeholder="Search mail"
                    placeholderTextColor={placeholderColor}
                    value={value}
                    onChangeText={onChangeText}
                />
                <Pressable className="p-1" onPress={() => onFilterOpenChange(!isFilterOpen)}>
                    <SlidersHorizontal size={18} color={filterIconColor} />
                </Pressable>
            </View>
            {isFilterOpen ? (
                <AdvancedSearchDropdown
                    onApply={onApplyFilters}
                    onClose={() => onFilterOpenChange(false)}
                    initialFilters={currentFilters}
                />
            ) : null}
        </View>
    )
}
