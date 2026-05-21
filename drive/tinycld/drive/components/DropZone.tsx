import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { Platform, Text, View } from 'react-native'
import type { DroppedEntry } from '../hooks/useFileUpload'

interface DropZoneProps {
    children: ReactNode
    onDrop: (files: File[]) => void
    onDropTree: (entries: DroppedEntry[]) => void
    isEnabled: boolean
}

function readEntriesPromise(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
    return new Promise((resolve, reject) => reader.readEntries(resolve, reject))
}

async function getAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
    const all: FileSystemEntry[] = []
    let batch: FileSystemEntry[]
    do {
        batch = await readEntriesPromise(reader)
        all.push(...batch)
    } while (batch.length > 0)
    return all
}

function fileFromEntry(entry: FileSystemFileEntry): Promise<File> {
    return new Promise((resolve, reject) => entry.file(resolve, reject))
}

async function walkEntry(entry: FileSystemEntry, path: string): Promise<DroppedEntry[]> {
    if (entry.isFile) {
        const file = await fileFromEntry(entry as FileSystemFileEntry)
        return [{ path, file }]
    }
    const dirEntry = entry as FileSystemDirectoryEntry
    const results: DroppedEntry[] = [{ path, file: null }]
    const children = await getAllEntries(dirEntry.createReader())
    for (const child of children) {
        const childResults = await walkEntry(child, `${path}/${child.name}`)
        results.push(...childResults)
    }
    return results
}

async function extractDroppedEntries(dataTransfer: DataTransfer): Promise<DroppedEntry[] | null> {
    const items = Array.from(dataTransfer.items)
    const entries = items.map((item) => item.webkitGetAsEntry?.()).filter((e): e is FileSystemEntry => e != null)

    const hasDirectory = entries.some((e) => e.isDirectory)
    if (!hasDirectory) return null

    const results: DroppedEntry[] = []
    for (const entry of entries) {
        const walked = await walkEntry(entry, entry.name)
        results.push(...walked)
    }
    return results
}

export function DropZone({ children, onDrop, onDropTree, isEnabled }: DropZoneProps) {
    const [isDragging, setIsDragging] = useState(false)
    const accentColor = useThemeColor('primary')

    if (Platform.OS !== 'web') {
        return <View className="flex-1">{children}</View>
    }

    const handleDragEnter = (e: React.DragEvent) => {
        if (!isEnabled) return
        e.preventDefault()
        e.stopPropagation()
        if (e.dataTransfer.types.includes('Files')) {
            setIsDragging(true)
        }
    }

    const handleDragOver = (e: React.DragEvent) => {
        if (!isEnabled) return
        e.preventDefault()
        e.stopPropagation()
    }

    const handleDragLeave = (e: React.DragEvent) => {
        if (!isEnabled) return
        e.preventDefault()
        e.stopPropagation()
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
        const { clientX, clientY } = e
        if (clientX <= rect.left || clientX >= rect.right || clientY <= rect.top || clientY >= rect.bottom) {
            setIsDragging(false)
        }
    }

    const handleDrop = async (e: React.DragEvent) => {
        if (!isEnabled) return
        e.preventDefault()
        e.stopPropagation()
        setIsDragging(false)

        const treeEntries = await extractDroppedEntries(e.dataTransfer)
        if (treeEntries) {
            onDropTree(treeEntries)
            return
        }

        const files = Array.from(e.dataTransfer.files)
        if (files.length > 0) {
            onDrop(files)
        }
    }

    return (
        // biome-ignore lint/a11y/noStaticElementInteractions: drag-and-drop zone requires native DOM events
        <div
            role="presentation"
            style={{
                flex: 1,
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
                overflow: 'hidden',
            }}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            {children}
            {isDragging && isEnabled && (
                <View
                    className="absolute top-0 left-0 right-0 bottom-0 items-center justify-center rounded-xl bg-accent/10"
                    style={{
                        borderWidth: 2,
                        borderStyle: 'dashed',
                        borderColor: accentColor,
                        zIndex: 100,
                    }}
                >
                    <Text className="text-accent" style={{ fontSize: 20, fontWeight: '600' }}>
                        Drop files to upload
                    </Text>
                </View>
            )}
        </div>
    )
}
