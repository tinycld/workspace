import { Modal, ModalBackdrop, ModalContent } from '@tinycld/core/ui/modal'
import { useCallback, useMemo, useState } from 'react'
import { Platform, Pressable, ScrollView, Text, View } from 'react-native'
import { type CsvDelimiter, parseCsv } from '../lib/csv/decode'

// CsvImportDialog is the confirm-and-preview surface for an in-flight
// CSV import. The parent owns the source text — the dialog re-parses
// whenever the delimiter changes so the preview reflects the user's
// choice — and receives the final (rows, target) tuple via onConfirm.
//
// Target ('new-sheet' vs 'replace-current') only matters for the
// in-editor entry point. The calc-index entry point (where the user
// arrives with no open workbook) always uses 'new-sheet' and can hide
// the radio by passing showTargetChooser={false}.

export type CsvImportTarget = 'new-sheet' | 'replace-current'

export interface CsvImportConfirm {
    rows: string[][]
    delimiter: CsvDelimiter | 'auto'
    target: CsvImportTarget
}

export interface CsvImportDialogProps {
    isOpen: boolean
    sourceText: string | null
    showTargetChooser?: boolean
    defaultTarget?: CsvImportTarget
    onConfirm: (result: CsvImportConfirm) => void
    onCancel: () => void
}

const DELIMITER_CHOICES: Array<{ id: CsvDelimiter | 'auto'; label: string }> = [
    { id: 'auto', label: 'Auto' },
    { id: ',', label: 'Comma' },
    { id: '\t', label: 'Tab' },
    { id: ';', label: 'Semicolon' },
]

const PREVIEW_ROWS = 5

export function CsvImportDialog({
    isOpen,
    sourceText,
    showTargetChooser = true,
    defaultTarget = 'new-sheet',
    onConfirm,
    onCancel,
}: CsvImportDialogProps) {
    const [delimiter, setDelimiter] = useState<CsvDelimiter | 'auto'>('auto')
    const [target, setTarget] = useState<CsvImportTarget>(defaultTarget)

    const parsed = useMemo<string[][]>(() => {
        if (sourceText == null) return []
        return parseCsv(sourceText, { delimiter })
    }, [sourceText, delimiter])

    const previewRows = parsed.slice(0, PREVIEW_ROWS)
    const totalRows = parsed.length
    const totalCols = parsed.reduce((m, r) => Math.max(m, r.length), 0)

    const handleConfirm = useCallback(() => {
        onConfirm({ rows: parsed, delimiter, target })
    }, [parsed, delimiter, target, onConfirm])

    return (
        <Modal isOpen={isOpen} onClose={onCancel}>
            <ModalBackdrop />
            <ModalContent className="w-[560px] max-h-[640px] p-0 rounded-xl bg-background">
                <View className="px-5 py-4 border-b border-border">
                    <Text className="text-base font-semibold text-foreground">
                        Import CSV
                    </Text>
                    <Text className="text-xs text-muted-foreground mt-1">
                        {totalRows} {totalRows === 1 ? 'row' : 'rows'} ×{' '}
                        {totalCols} {totalCols === 1 ? 'column' : 'columns'}
                    </Text>
                </View>

                <View className="px-5 py-4 gap-4">
                    <DelimiterChooser value={delimiter} onChange={setDelimiter} />
                    <TargetChooser
                        isVisible={showTargetChooser}
                        value={target}
                        onChange={setTarget}
                    />
                    <PreviewTable rows={previewRows} totalCols={totalCols} />
                </View>

                <View className="flex-row items-center justify-end gap-2 px-5 py-3 border-t border-border">
                    <Pressable
                        accessibilityRole="button"
                        onPress={onCancel}
                        className="px-3 py-2 rounded-md hover:bg-surface-secondary"
                    >
                        <Text className="text-sm text-foreground">Cancel</Text>
                    </Pressable>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Confirm CSV import"
                        onPress={handleConfirm}
                        disabled={parsed.length === 0}
                        className="px-3 py-2 rounded-md bg-accent disabled:opacity-50"
                    >
                        <Text className="text-sm font-medium text-accent-foreground">
                            Import
                        </Text>
                    </Pressable>
                </View>
            </ModalContent>
        </Modal>
    )
}

interface DelimiterChooserProps {
    value: CsvDelimiter | 'auto'
    onChange: (value: CsvDelimiter | 'auto') => void
}

function DelimiterChooser({ value, onChange }: DelimiterChooserProps) {
    return (
        <View className="gap-2">
            <Text className="text-xs font-medium text-muted-foreground">Delimiter</Text>
            <View className="flex-row gap-2 flex-wrap">
                {DELIMITER_CHOICES.map(choice => {
                    const isActive = choice.id === value
                    return (
                        <Pressable
                            key={choice.label}
                            accessibilityRole="button"
                            accessibilityLabel={`Delimiter ${choice.label}`}
                            accessibilityState={{ selected: isActive }}
                            onPress={() => onChange(choice.id)}
                            hitSlop={Platform.OS === 'web' ? undefined : { top: 6, bottom: 6, left: 4, right: 4 }}
                            className={
                                isActive
                                    ? 'px-3 py-1.5 rounded-md bg-accent'
                                    : 'px-3 py-1.5 rounded-md bg-surface-secondary'
                            }
                        >
                            <Text
                                className={
                                    isActive
                                        ? 'text-xs text-accent-foreground'
                                        : 'text-xs text-foreground'
                                }
                            >
                                {choice.label}
                            </Text>
                        </Pressable>
                    )
                })}
            </View>
        </View>
    )
}

interface TargetChooserProps {
    isVisible: boolean
    value: CsvImportTarget
    onChange: (value: CsvImportTarget) => void
}

function TargetChooser({ isVisible, value, onChange }: TargetChooserProps) {
    if (!isVisible) return null
    return (
        <View className="gap-2">
            <Text className="text-xs font-medium text-muted-foreground">Destination</Text>
            <RadioRow
                label="Import as new sheet"
                isSelected={value === 'new-sheet'}
                onPress={() => onChange('new-sheet')}
            />
            <RadioRow
                label="Replace current sheet"
                isSelected={value === 'replace-current'}
                onPress={() => onChange('replace-current')}
            />
        </View>
    )
}

interface RadioRowProps {
    label: string
    isSelected: boolean
    onPress: () => void
}

function RadioRow({ label, isSelected, onPress }: RadioRowProps) {
    return (
        <Pressable
            accessibilityRole="radio"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={label}
            onPress={onPress}
            hitSlop={Platform.OS === 'web' ? undefined : { top: 6, bottom: 6, left: 4, right: 4 }}
            className="flex-row items-center gap-2 py-1"
        >
            <View
                className={
                    isSelected
                        ? 'w-4 h-4 rounded-full border-2 border-accent items-center justify-center'
                        : 'w-4 h-4 rounded-full border-2 border-border items-center justify-center'
                }
            >
                {isSelected ? <View className="w-2 h-2 rounded-full bg-accent" /> : null}
            </View>
            <Text className="text-sm text-foreground">{label}</Text>
        </Pressable>
    )
}

interface PreviewTableProps {
    rows: string[][]
    totalCols: number
}

function PreviewTable({ rows, totalCols }: PreviewTableProps) {
    if (rows.length === 0 || totalCols === 0) {
        return (
            <View className="py-6 items-center">
                <Text className="text-xs text-muted-foreground">No rows to preview</Text>
            </View>
        )
    }
    return (
        <View className="gap-1">
            <Text className="text-xs font-medium text-muted-foreground">
                Preview (first {rows.length} {rows.length === 1 ? 'row' : 'rows'})
            </Text>
            <ScrollView
                horizontal
                className="border border-border rounded-md max-h-40"
                contentContainerStyle={{ flexGrow: 1 }}
            >
                <View>
                    {rows.map((row, r) => (
                        <View key={`${r}`} className="flex-row">
                            {Array.from({ length: totalCols }).map((_, c) => (
                                <View
                                    key={`${c}`}
                                    className="px-2 py-1 border-r border-b border-border min-w-[80px]"
                                >
                                    <Text
                                        className="text-xs text-foreground"
                                        numberOfLines={1}
                                    >
                                        {row[c] ?? ''}
                                    </Text>
                                </View>
                            ))}
                        </View>
                    ))}
                </View>
            </ScrollView>
        </View>
    )
}
