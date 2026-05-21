import { eq } from '@tanstack/db'
import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'
import { useCreateDriveItem } from '@tinycld/drive/lib/upload-to-drive'
import { router } from 'expo-router'
import { FilePlus2, FileSpreadsheet, Upload } from 'lucide-react-native'
import { useCallback, useState } from 'react'
import { Platform, Pressable, ScrollView, Text, View } from 'react-native'
import { CsvImportDialog } from '../components/CsvImportDialog'
import { blankWorkbookBlob } from '../lib/blank-workbook'
import { useCsvImportStore } from '../lib/csv/import-store'
import { XLSX_MIME_TYPE } from '../types'

export default function CalcIndex() {
    const orgHref = useOrgHref()
    const [driveItems] = useStore('drive_items')
    const create = useCreateDriveItem()
    const setPendingImport = useCsvImportStore(s => s.set)
    const [pickedCsv, setPickedCsv] = useState<{ text: string; name: string } | null>(null)

    const { data: items = [] } = useOrgLiveQuery((query, { orgId }) =>
        query
            .from({ item: driveItems })
            .where(({ item }) => eq(item.org, orgId))
            .where(({ item }) => eq(item.mime_type, XLSX_MIME_TYPE))
            .where(({ item }) => eq(item.is_folder, false))
            .orderBy(({ item }) => item.updated, 'desc')
    )

    const handleNew = useCallback(async () => {
        const result = await create.mutateAsync({
            body: blankWorkbookBlob(),
            name: 'Untitled.xlsx',
            mimeType: XLSX_MIME_TYPE,
        })
        router.push(orgHref('calc/[id]', { id: result.itemId }))
    }, [create, orgHref])

    const handlePickCsv = useCallback(async () => {
        const picked = await pickCsvFile()
        if (picked == null) return
        setPickedCsv(picked)
    }, [])

    const handleImportConfirm = useCallback(
        async (rows: string[][]) => {
            const filename = pickedCsv?.name ?? 'imported.csv'
            setPickedCsv(null)
            if (rows.length === 0) return
            const baseName = stripCsvExtension(filename) || 'Imported'
            const result = await create.mutateAsync({
                body: blankWorkbookBlob(),
                name: `${baseName}.xlsx`,
                mimeType: XLSX_MIME_TYPE,
            })
            setPendingImport(result.itemId, { rows, mode: 'new-sheet' })
            router.push(orgHref('calc/[id]', { id: result.itemId }))
        },
        [pickedCsv, create, orgHref, setPendingImport]
    )

    const isEmpty = items.length === 0

    return (
        <ScrollView className="flex-1 bg-background">
            <View className="p-6 gap-4">
                <View className="flex-row items-center justify-between">
                    <Text
                        accessibilityRole="header"
                        aria-level={2}
                        className="text-2xl font-semibold text-foreground"
                    >
                        Calc
                    </Text>
                    <View className="flex-row items-center gap-2">
                        <ImportCsvButton onPress={handlePickCsv} />
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="New spreadsheet"
                            onPress={handleNew}
                            disabled={create.isPending}
                            className="flex-row items-center gap-2 px-3 py-2 rounded-md bg-accent"
                        >
                            <FilePlus2 size={16} color="white" />
                            <Text className="text-sm font-medium text-accent-foreground">
                                {create.isPending ? 'Creating…' : 'New spreadsheet'}
                            </Text>
                        </Pressable>
                    </View>
                </View>

                <EmptyState isVisible={isEmpty && !create.isPending} />

                <View className="gap-1">
                    {items.map(item => (
                        <WorkbookRow key={item.id} item={item} />
                    ))}
                </View>
            </View>
            <CsvImportDialog
                isOpen={pickedCsv != null}
                sourceText={pickedCsv?.text ?? null}
                showTargetChooser={false}
                onCancel={() => setPickedCsv(null)}
                onConfirm={({ rows }) => {
                    void handleImportConfirm(rows)
                }}
            />
        </ScrollView>
    )
}

interface ImportCsvButtonProps {
    onPress: () => void
}

function ImportCsvButton({ onPress }: ImportCsvButtonProps) {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel="Import CSV"
            onPress={onPress}
            className="flex-row items-center gap-2 px-3 py-2 rounded-md bg-surface-secondary"
        >
            <Upload size={16} color="#444" />
            <Text className="text-sm font-medium text-foreground">Import CSV</Text>
        </Pressable>
    )
}

interface EmptyStateProps {
    isVisible: boolean
}

function EmptyState({ isVisible }: EmptyStateProps) {
    if (!isVisible) return null
    return (
        <View className="py-12 items-center gap-2">
            <FileSpreadsheet size={32} color="#888" />
            <Text className="text-sm text-muted-foreground">No spreadsheets yet</Text>
            <Text className="text-xs text-muted-foreground">Create one to get started.</Text>
        </View>
    )
}

interface WorkbookRowProps {
    item: { id: string; name: string; updated: string; size: number }
}

function WorkbookRow({ item }: WorkbookRowProps) {
    const orgHref = useOrgHref()
    return (
        <Pressable
            onPress={() => router.push(orgHref('calc/[id]', { id: item.id }))}
            className="flex-row items-center gap-3 px-3 py-2 rounded-md hover:bg-surface-secondary"
        >
            <FileSpreadsheet size={20} color="#22a06b" />
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

interface PickedCsv {
    text: string
    name: string
}

function stripCsvExtension(name: string): string {
    return name.replace(/\.(csv|tsv|txt)$/i, '')
}

async function pickCsvFile(): Promise<PickedCsv | null> {
    if (Platform.OS === 'web') {
        return pickCsvFileWeb()
    }
    return pickCsvFileNative()
}

function pickCsvFileWeb(): Promise<PickedCsv | null> {
    if (typeof document === 'undefined') return Promise.resolve(null)
    return new Promise(resolve => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = '.csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain'
        let settled = false
        const settle = (value: PickedCsv | null) => {
            if (settled) return
            settled = true
            resolve(value)
        }
        input.onchange = async () => {
            const file = input.files?.[0]
            if (file == null) return settle(null)
            const text = await file.text()
            settle({ text, name: file.name })
        }
        input.addEventListener('cancel', () => settle(null))
        input.click()
    })
}

async function pickCsvFileNative(): Promise<PickedCsv | null> {
    const picker = await import('expo-document-picker')
    const fs = await import('expo-file-system')
    const result = await picker.getDocumentAsync({
        type: ['text/csv', 'text/tab-separated-values', 'text/plain'],
        copyToCacheDirectory: true,
    })
    if (result.canceled) return null
    const asset = result.assets?.[0]
    if (asset == null) return null
    const fileSystem = fs as unknown as {
        readAsStringAsync: (uri: string) => Promise<string>
    }
    const text = await fileSystem.readAsStringAsync(asset.uri)
    return { text, name: asset.name ?? 'imported.csv' }
}
