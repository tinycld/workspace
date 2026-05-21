import { FrozenSlideStack } from '@tinycld/core/components/workspace/FrozenStack'
import { useBreakpoint } from '@tinycld/core/components/workspace/useBreakpoint'
import { useWorkspaceStore } from '@tinycld/core/lib/stores/workspace-store'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { View } from 'react-native'
import { SearchBar } from '../components/SearchBar'
import { composeEvents, handleNewComposeIntent } from '../hooks/composeEvents'
import { useMailSearch } from '../hooks/useMailSearch'
import {
    type AdvancedSearchFilters,
    countActiveFilters,
    hasActiveFilters,
    SearchContext,
} from '../hooks/useSearchState'
import { useComposeStore } from '../stores/compose-store'

// Lazy boundary keeps the rich-text editor (and its transitive
// prosemirror-view top-level DOM access) out of the static import
// graph that mounts at app launch via expo-router's <Stack>.
const ComposeWindow = lazy(() => import('../components/ComposeWindow'))

export { useThreadListContext } from '../stores/thread-list-store'

export default function MailLayout() {
    const [searchQuery, setSearchQuery] = useState('')
    const [advancedFilters, setAdvancedFilters] = useState<AdvancedSearchFilters>({})
    const [isFilterOpen, setIsFilterOpen] = useState(false)
    const breakpoint = useBreakpoint()
    const setDrawerOpen = useWorkspaceStore((s) => s.setDrawerOpen)
    const composeMode = useComposeStore((s) => s.mode)

    useEffect(() => {
        return composeEvents.subscribe(() => {
            handleNewComposeIntent(useComposeStore.getState())
        })
    }, [])

    const { results, total, isSearching } = useMailSearch(searchQuery, advancedFilters)

    const activeFilterCount = countActiveFilters(advancedFilters)

    const searchValue = useMemo(
        () => ({
            query: searchQuery,
            results,
            total,
            isSearching,
            isActive: searchQuery.length >= 2 || hasActiveFilters(advancedFilters),
            filters: advancedFilters,
        }),
        [searchQuery, results, total, isSearching, advancedFilters]
    )

    const isComposeVisible = composeMode !== 'closed' && composeMode !== 'inline'
    const isMobile = breakpoint === 'mobile'

    return (
        <SearchContext.Provider value={searchValue}>
            <View className="flex-1 bg-background">
                <View className="px-4 py-2">
                    <SearchBar
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                        onMenuPress={isMobile ? () => setDrawerOpen(true) : undefined}
                        isFilterOpen={isFilterOpen}
                        onFilterOpenChange={setIsFilterOpen}
                        onApplyFilters={setAdvancedFilters}
                        activeFilterCount={activeFilterCount}
                        currentFilters={advancedFilters}
                    />
                </View>
                <View className="flex-1">
                    <FrozenSlideStack />
                </View>
                {isComposeVisible ? (
                    <Suspense fallback={null}>
                        <ComposeWindow isVisible={isComposeVisible} />
                    </Suspense>
                ) : null}
            </View>
        </SearchContext.Provider>
    )
}
