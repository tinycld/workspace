import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { router } from 'expo-router'
import { FilePlus2, FileText, LayoutTemplate } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { TemplatePicker } from '../components/TemplatePicker'
import {
    useCreateBlankTextDocument,
    useCreateTextDocumentFromTemplate,
    useTextDocuments,
} from '../hooks/use-text-documents'
import type { TemplateId } from '../lib/templates/index'

export default function TextIndex() {
    const orgHref = useOrgHref()
    const { data: items = [] } = useTextDocuments()
    const blank = useCreateBlankTextDocument()
    const template = useCreateTextDocumentFromTemplate()
    // Single-component-local UI state, no other surface needs to read /
    // mutate the picker's open/closed state, so a plain useState is the
    // right primitive here (a Zustand store would be overkill).
    const [isPickerOpen, setPickerOpen] = useState(false)
    const accentFg = useThemeColor('accent-foreground')
    const foreground = useThemeColor('foreground')

    const goToDoc = (itemId: string) => router.push(orgHref('text/[id]', { id: itemId }))

    const handleNew = () => blank.create(goToDoc)
    const handleOpenPicker = () => setPickerOpen(true)
    const handleClosePicker = () => setPickerOpen(false)
    const handlePickTemplate = (id: TemplateId) => {
        setPickerOpen(false)
        // Blank picks bypass the template upload path so the existing
        // server-side empty-docx bootstrap still runs — same behavior the
        // primary "New document" button has had.
        if (id === 'blank') {
            blank.create(goToDoc)
            return
        }
        template.create(id, goToDoc)
    }

    const isEmpty = items.length === 0
    const isBusy = blank.isPending || template.isPending

    return (
        <ScrollView className="flex-1 bg-background">
            <View className="p-6 gap-4">
                <View className="flex-row items-center justify-between">
                    <Text
                        accessibilityRole="header"
                        aria-level={2}
                        className="text-2xl font-semibold text-foreground"
                    >
                        Text
                    </Text>
                    <View className="flex-row items-center gap-2">
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="From template…"
                            onPress={handleOpenPicker}
                            disabled={isBusy}
                            className="flex-row items-center gap-2 px-3 py-2 rounded-md bg-surface-secondary hover:bg-surface-tertiary disabled:opacity-50"
                        >
                            <LayoutTemplate size={16} color={foreground} />
                            <Text className="text-sm font-medium text-foreground">
                                From template…
                            </Text>
                        </Pressable>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="New document"
                            onPress={handleNew}
                            disabled={isBusy}
                            className="flex-row items-center gap-2 px-3 py-2 rounded-md bg-accent disabled:opacity-50"
                        >
                            <FilePlus2 size={16} color={accentFg} />
                            <Text className="text-sm font-medium text-accent-foreground">
                                {blank.isPending ? 'Creating…' : 'New document'}
                            </Text>
                        </Pressable>
                    </View>
                </View>

                <EmptyState isVisible={isEmpty && !isBusy} />

                <View className="gap-1">
                    {items.map(item => (
                        <DocumentRow key={item.id} item={item} />
                    ))}
                </View>
            </View>

            <TemplatePicker
                isOpen={isPickerOpen}
                onClose={handleClosePicker}
                onPick={handlePickTemplate}
                isPending={template.isPending}
            />
        </ScrollView>
    )
}

interface EmptyStateProps {
    isVisible: boolean
}

function EmptyState({ isVisible }: EmptyStateProps) {
    const mutedFg = useThemeColor('muted-foreground')
    if (!isVisible) return null
    return (
        <View className="py-12 items-center gap-2">
            <FileText size={32} color={mutedFg} />
            <Text className="text-sm text-muted-foreground">No documents yet</Text>
            <Text className="text-xs text-muted-foreground">Create one to get started.</Text>
        </View>
    )
}

interface DocumentRowProps {
    item: { id: string; name: string; updated: string }
}

function DocumentRow({ item }: DocumentRowProps) {
    const orgHref = useOrgHref()
    // `primary` is the project's brand teal — the closest semantic match for the
    // original `#3b82f6` file-icon tint. `accent` in this theme is a soft
    // background fill (very pale teal in light mode) and would render invisible
    // here, so we deliberately don't use it.
    const primary = useThemeColor('primary')
    return (
        <Pressable
            onPress={() => router.push(orgHref('text/[id]', { id: item.id }))}
            className="flex-row items-center gap-3 px-3 py-2 rounded-md hover:bg-surface-secondary"
        >
            <FileText size={20} color={primary} />
            <View className="flex-1">
                <Text className="text-sm text-foreground" numberOfLines={1}>
                    {item.name}
                </Text>
                <Text className="text-xs text-muted-foreground">{formatUpdated(item.updated)}</Text>
            </View>
        </Pressable>
    )
}

function formatUpdated(iso: string): string {
    if (!iso) return ''
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return ''
    return date.toLocaleDateString()
}
