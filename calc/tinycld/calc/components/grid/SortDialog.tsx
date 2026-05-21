import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Dimensions, Platform, Pressable, ScrollView, Text, View } from 'react-native'
import type * as Y from 'yjs'
import { useGridStore, useGridStoreApi } from '../../hooks/use-grid-store'
import { isDisjoint, primaryRange } from '../../lib/selection-range'
import { detectHeaderRow, sortRange } from '../../lib/sort'
import { columnLabel } from '../../lib/workbook-types'

interface SortDialogProps {
    doc: Y.Doc | null
    sheetId: string
}

// Modal sort dialog. Reads the active selection range as the sort
// scope; offers a column picker (one entry per column in the range), a
// direction radio (A→Z / Z→A), and a "Data has header row" checkbox
// preselected via detectHeaderRow.
//
// Renders as an absolutely-positioned panel centered in the viewport
// with a scrim behind it. Web outside-click dismissal mirrors the
// CellContextMenu pattern; native uses a Pressable scrim.
export function SortDialog({ doc, sheetId }: SortDialogProps) {
    const isOpen = useGridStore(s => s.sortDialogOpen)
    const selection = useGridStore(s => s.sortDialogOpen ? s.selection : null)
    const store = useGridStoreApi()
    const onClose = useCallback(() => store.getState().closeSortDialog(), [store])

    // Sort operates on a single contiguous rectangle. On a disjoint
    // selection the action falls through with range=null, which the
    // early-return at the bottom of this component renders nothing
    // (Tier B policy from the plan).
    const range = isDisjoint(selection) ? null : primaryRange(selection)
    const fg = useThemeColor('foreground')

    const columns = useMemo(() => {
        if (range == null) return [] as number[]
        const out: number[] = []
        for (let c = range.startCol; c <= range.endCol; c++) out.push(c)
        return out
    }, [range])

    const detectedHeader = useMemo(() => {
        if (doc == null || range == null) return false
        return detectHeaderRow(doc, sheetId, range)
    }, [doc, sheetId, range])

    const [colIndex, setColIndex] = useState<number>(range?.startCol ?? 1)
    const [direction, setDirection] = useState<'asc' | 'desc'>('asc')
    const [hasHeader, setHasHeader] = useState<boolean>(detectedHeader)

    // Re-seed local state each time the dialog opens so a fresh
    // selection picks the right defaults. Without this the prior
    // session's column/direction sticks across opens.
    useEffect(() => {
        if (!isOpen) return
        setColIndex(range?.startCol ?? 1)
        setDirection('asc')
        setHasHeader(detectedHeader)
    }, [isOpen, range?.startCol, detectedHeader])

    const onApply = useCallback(() => {
        if (doc == null || range == null) {
            onClose()
            return
        }
        const result = sortRange(doc, sheetId, range, colIndex, direction, hasHeader)
        if (result.ok && result.mergesBroken > 0) {
            store.getState().setSortStatus({ mergesBroken: result.mergesBroken })
        }
        onClose()
    }, [doc, sheetId, range, colIndex, direction, hasHeader, onClose, store])

    if (!isOpen || range == null) return null

    const window = Dimensions.get('window')
    const panelWidth = Math.min(360, window.width - 32)

    return (
        <View
            style={{
                position: 'absolute',
                left: 0,
                top: 0,
                right: 0,
                bottom: 0,
                zIndex: 50,
            }}
            pointerEvents="box-none"
        >
            <Pressable
                onPress={onClose}
                accessibilityLabel="Dismiss sort dialog"
                style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: 'rgba(0,0,0,0.2)',
                }}
            />
            <View
                accessibilityLabel="Sort range dialog"
                className="bg-background border border-border rounded-lg"
                style={{
                    position: 'absolute',
                    top: Math.max(40, window.height / 2 - 160),
                    left: window.width / 2 - panelWidth / 2,
                    width: panelWidth,
                    padding: 16,
                    ...(Platform.OS === 'web'
                        ? ({ boxShadow: '0 4px 16px rgba(0,0,0,0.15)' } as object)
                        : {
                              elevation: 8,
                              shadowColor: '#000',
                              shadowOffset: { width: 0, height: 4 },
                              shadowOpacity: 0.15,
                              shadowRadius: 12,
                          }),
                }}
            >
                <Text className="text-foreground" style={{ fontSize: 16, fontWeight: '600' }}>
                    Sort range
                </Text>
                <View style={{ height: 12 }} />

                <Text className="text-foreground" style={{ fontSize: 12, marginBottom: 4 }}>
                    Sort by column
                </Text>
                <ScrollView
                    style={{ maxHeight: 140, borderWidth: 1, borderRadius: 4 }}
                    className="border-border"
                >
                    {columns.map(c => {
                        const isActive = c === colIndex
                        return (
                            <Pressable
                                key={c}
                                onPress={() => setColIndex(c)}
                                accessibilityLabel={`Column ${columnLabel(c)}`}
                                accessibilityRole="button"
                                accessibilityState={{ selected: isActive }}
                                className={`px-3 py-2 ${isActive ? 'bg-accent' : ''}`}
                            >
                                <Text
                                    className={isActive ? 'text-accent-foreground' : 'text-foreground'}
                                    style={{ fontSize: 14 }}
                                >
                                    Column {columnLabel(c)}
                                </Text>
                            </Pressable>
                        )
                    })}
                </ScrollView>

                <View style={{ height: 12 }} />
                <Text className="text-foreground" style={{ fontSize: 12, marginBottom: 4 }}>
                    Direction
                </Text>
                <View className="flex-row" style={{ gap: 8 }}>
                    <RadioOption
                        label="A → Z"
                        accessibilityLabel="Sort ascending"
                        active={direction === 'asc'}
                        onPress={() => setDirection('asc')}
                    />
                    <RadioOption
                        label="Z → A"
                        accessibilityLabel="Sort descending"
                        active={direction === 'desc'}
                        onPress={() => setDirection('desc')}
                    />
                </View>

                <View style={{ height: 12 }} />
                <Pressable
                    onPress={() => setHasHeader(v => !v)}
                    accessibilityLabel="Data has header row"
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: hasHeader }}
                    hitSlop={Platform.OS === 'web' ? undefined : { top: 6, bottom: 6, left: 4, right: 4 }}
                    className="flex-row items-center"
                    style={{ gap: 8 }}
                >
                    <View
                        className={`border ${hasHeader ? 'bg-accent border-accent' : 'border-border'}`}
                        style={{
                            width: 16,
                            height: 16,
                            borderRadius: 3,
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        {hasHeader ? (
                            <Text style={{ color: fg, fontSize: 12 }}>✓</Text>
                        ) : null}
                    </View>
                    <Text className="text-foreground" style={{ fontSize: 14 }}>
                        Data has header row
                    </Text>
                </Pressable>

                <View style={{ height: 16 }} />
                <View className="flex-row items-center justify-end" style={{ gap: 8 }}>
                    <Pressable
                        onPress={onClose}
                        accessibilityLabel="Cancel sort"
                        className="px-3 py-2 rounded border border-border"
                    >
                        <Text className="text-foreground" style={{ fontSize: 14 }}>
                            Cancel
                        </Text>
                    </Pressable>
                    <Pressable
                        onPress={onApply}
                        accessibilityLabel="Apply sort"
                        className="px-3 py-2 rounded bg-accent"
                    >
                        <Text className="text-accent-foreground" style={{ fontSize: 14 }}>
                            Sort
                        </Text>
                    </Pressable>
                </View>
            </View>
        </View>
    )
}

interface RadioOptionProps {
    label: string
    accessibilityLabel: string
    active: boolean
    onPress: () => void
}

function RadioOption({ label, accessibilityLabel, active, onPress }: RadioOptionProps) {
    return (
        <Pressable
            onPress={onPress}
            accessibilityLabel={accessibilityLabel}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            hitSlop={Platform.OS === 'web' ? undefined : { top: 6, bottom: 6, left: 4, right: 4 }}
            className={`px-3 py-2 rounded border ${active ? 'bg-accent border-accent' : 'border-border'}`}
        >
            <Text
                className={active ? 'text-accent-foreground' : 'text-foreground'}
                style={{ fontSize: 14 }}
            >
                {label}
            </Text>
        </Pressable>
    )
}
