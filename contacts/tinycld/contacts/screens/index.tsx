import { DataTableHeader } from '@tinycld/core/components/DataTableHeader'
import { MenuCheckboxItem } from '@tinycld/core/components/DropdownMenu'
import { EmptyState } from '@tinycld/core/components/EmptyState'
import { HelpIcon } from '@tinycld/core/components/help/HelpIcon'
import { LoadingState } from '@tinycld/core/components/LoadingState'
import { SwipeableRowProvider } from '@tinycld/core/components/SwipeableRow'
import { useBreakpoint } from '@tinycld/core/components/workspace/useBreakpoint'
import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { queryClient } from '@tinycld/core/lib/pocketbase'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Menu } from '@tinycld/core/ui/menu'
import { useLabels } from '@tinycld/core/ui/hooks/useLabels'
import { useLocalSearchParams } from 'expo-router'
import { ArrowUpDown } from 'lucide-react-native'
import { useCallback, useState } from 'react'
import { FlashList } from '@shopify/flash-list'
import { Pressable, RefreshControl, Text, TextInput, View } from 'react-native'
import { ContactRow } from '../components/ContactRow'
import { useContactList } from '../hooks/useContactList'
import { useContactSearch } from '../hooks/useContactSearch'
import { useContactsShortcuts } from '../hooks/useContactsShortcuts'
import { type SortField, useContactsUIStore } from '../stores/contacts-ui-store'

const CONTACT_COLUMNS: { label: string; flex: number; sortField: SortField }[] = [
    { label: 'Name', flex: 2, sortField: 'first_name' },
    { label: 'Email', flex: 2, sortField: 'email' },
    { label: 'Phone', flex: 1, sortField: 'phone' },
]

const SORT_OPTIONS: { field: SortField; label: string }[] = [
    { field: 'first_name', label: 'First name' },
    { field: 'last_name', label: 'Last name' },
    { field: 'email', label: 'Email' },
    { field: 'phone', label: 'Phone' },
    { field: 'company', label: 'Company' },
]

function MobileSortMenu({ iconColor }: { iconColor: string }) {
    const sortField = useContactsUIStore((s) => s.sortField)
    const sortDirection = useContactsUIStore((s) => s.sortDirection)
    const toggleSort = useContactsUIStore((s) => s.toggleSort)

    return (
        <Menu>
            <Menu.Trigger>
                <Pressable className="p-2" accessibilityLabel="Sort contacts">
                    <ArrowUpDown size={18} color={iconColor} />
                </Pressable>
            </Menu.Trigger>
            <Menu.Portal>
                <Menu.Overlay />
                <Menu.Content presentation="popover" placement="bottom" align="end">
                    <Menu.Label>Sort by</Menu.Label>
                    {SORT_OPTIONS.map((opt) => {
                        const isActive = sortField === opt.field
                        const arrow = isActive ? (sortDirection === 'asc' ? ' ↑' : ' ↓') : ''
                        return (
                            <MenuCheckboxItem
                                key={opt.field}
                                label={`${opt.label}${arrow}`}
                                checked={isActive}
                                onToggle={() => toggleSort(opt.field)}
                            />
                        )
                    })}
                </Menu.Content>
            </Menu.Portal>
        </Menu>
    )
}

export default function ContactListScreen() {
    const [searchQuery, setSearchQuery] = useState('')
    const [isRefreshing, setIsRefreshing] = useState(false)
    const handleRefresh = useCallback(async () => {
        setIsRefreshing(true)
        try {
            await queryClient.invalidateQueries()
        } finally {
            setIsRefreshing(false)
        }
    }, [])
    const orgHref = useOrgHref()
    const newContactHref = orgHref('contacts/new')
    const { filter, label: activeLabelId } = useLocalSearchParams<{
        filter?: string
        label?: string
    }>()

    const { labelMap } = useLabels()
    const isCompact = useBreakpoint() === 'mobile'
    const mutedColor = useThemeColor('muted-foreground')
    const placeholderColor = useThemeColor('field-placeholder')

    const sortField = useContactsUIStore((s) => s.sortField)
    const sortDirection = useContactsUIStore((s) => s.sortDirection)
    const toggleSort = useContactsUIStore((s) => s.toggleSort)

    const useServerSearch = searchQuery.length >= 2
    const { results: serverResults } = useContactSearch(useServerSearch ? searchQuery : '')

    const {
        contacts,
        filteredContacts,
        isLoading,
        isDeleted,
        assignmentsByContact,
        toggleFavorite,
        deleteContact,
        restoreContact,
        permanentlyDeleteContact,
    } = useContactList({
        filter,
        activeLabelId,
        searchQuery,
        serverSearchResults: serverResults,
    })

    const count = filteredContacts?.length ?? 0

    const { focusedId } = useContactsShortcuts({
        items: filteredContacts ?? [],
        isEnabled: true,
        listKey: `${filter ?? ''}:${activeLabelId ?? ''}:${useServerSearch ? 'search' : 'all'}`,
    })

    const activeLabel = activeLabelId ? labelMap.get(activeLabelId) : null
    const title = activeLabel
        ? activeLabel.name
        : isDeleted
          ? 'Deleted'
          : filter === 'favorites'
            ? 'Favorites'
            : 'Contacts'

    const getItemType = useCallback(() => (isCompact ? 'mobile' : 'desktop'), [isCompact])

    const renderContact = useCallback(
        ({ item: contact, index }: { item: NonNullable<typeof filteredContacts>[number]; index: number }) => {
            const labelIds = assignmentsByContact.get(contact.id)
            const contactLabels = labelIds
                ? Array.from(labelIds)
                      .map((id) => labelMap.get(id))
                      .filter((l): l is { id: string; name: string; color: string } => l != null)
                : []

            return (
                <ContactRow
                    contact={contact}
                    labels={contactLabels}
                    onToggleFavorite={() =>
                        toggleFavorite.mutate({
                            id: contact.id,
                            currentFavorite: contact.favorite,
                        })
                    }
                    onDelete={() => deleteContact.mutate(contact.id)}
                    onRestore={isDeleted ? () => restoreContact.mutate(contact.id) : undefined}
                    onPermanentDelete={isDeleted ? () => permanentlyDeleteContact.mutate(contact.id) : undefined}
                    index={index}
                    isFocused={contact.id === focusedId}
                />
            )
        },
        [
            assignmentsByContact,
            labelMap,
            toggleFavorite,
            deleteContact,
            restoreContact,
            permanentlyDeleteContact,
            isDeleted,
            focusedId,
        ]
    )

    if (isLoading) {
        return <LoadingState />
    }

    const isEmpty = !contacts || contacts.length === 0

    if (isEmpty && !filter && !activeLabelId) {
        return <EmptyState message="No contacts yet." action={{ label: '+ Add Contact', href: newContactHref }} />
    }

    const horizontalPadding = isCompact ? 12 : 24

    return (
        <View className="flex-1 bg-background">
            <View
                style={{
                    paddingHorizontal: horizontalPadding,
                    paddingTop: isCompact ? 12 : 20,
                    paddingBottom: 0,
                }}
            >
                <View
                    className={`flex-row justify-between items-center ${isCompact ? 'mb-2 flex-wrap gap-2' : 'mb-4 flex-nowrap'}`}
                >
                    <View className="flex-row items-center gap-2">
                        <Text
                            className="font-bold text-foreground"
                            style={{
                                fontSize: isCompact ? 20 : 24,
                            }}
                        >
                            {title} ({count})
                        </Text>
                        <HelpIcon topic="contacts:getting-started" size={18} />
                    </View>
                    <View className="flex-row items-center gap-1">
                        <TextInput
                            placeholder="Search contacts..."
                            value={searchQuery}
                            onChangeText={setSearchQuery}
                            className="border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground"
                            style={{
                                width: isCompact ? 200 : 250,
                            }}
                            placeholderTextColor={placeholderColor}
                        />
                        {isCompact ? <MobileSortMenu iconColor={mutedColor} /> : null}
                    </View>
                </View>
            </View>

            {isCompact ? null : (
                <View style={{ paddingHorizontal: horizontalPadding }}>
                    <DataTableHeader
                        columns={CONTACT_COLUMNS}
                        leadingWidth={52}
                        sortField={sortField}
                        sortDirection={sortDirection}
                        onSort={toggleSort}
                    />
                </View>
            )}

            {count === 0 && (filter || activeLabelId) ? (
                <View className="flex-1 items-center justify-center p-10">
                    <Text className="text-base text-muted-foreground">
                        No {filter === 'favorites' ? 'favorite ' : ''}contacts
                        {activeLabel ? ` with label "${activeLabel.name}"` : ''}.
                    </Text>
                </View>
            ) : (
                <SwipeableRowProvider>
                    <FlashList
                        data={filteredContacts ?? []}
                        keyExtractor={(item) => item.id}
                        getItemType={getItemType}
                        renderItem={renderContact}
                        contentContainerStyle={{ paddingHorizontal: isCompact ? 12 : 24 }}
                        refreshControl={
                            isCompact ? (
                                <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />
                            ) : undefined
                        }
                    />
                </SwipeableRowProvider>
            )}
        </View>
    )
}
