import {
    File,
    FileArchive,
    FileCode,
    FileSpreadsheet,
    FileText,
    Film,
    Folder,
    Image,
    type LucideIcon,
    Music,
    Palette,
    Presentation,
} from 'lucide-react-native'

export type FileCategory =
    | 'folder'
    | 'document'
    | 'spreadsheet'
    | 'pdf'
    | 'image'
    | 'presentation'
    | 'drawing'
    | 'video'
    | 'audio'
    | 'archive'
    | 'code'
    | 'unknown'

export interface FileIconConfig {
    icon: LucideIcon
    color: string
}

interface FileIconEntry {
    icon: LucideIcon
    brandColor?: string
}

const fileIconMap: Record<FileCategory, FileIconEntry> = {
    folder: { icon: Folder },
    document: { icon: FileText, brandColor: '#4285F4' },
    spreadsheet: { icon: FileSpreadsheet, brandColor: '#0F9D58' },
    pdf: { icon: FileText, brandColor: '#EA4335' },
    image: { icon: Image, brandColor: '#F5A623' },
    presentation: { icon: Presentation, brandColor: '#FBBC04' },
    drawing: { icon: Palette, brandColor: '#EA4335' },
    video: { icon: Film, brandColor: '#EA4335' },
    audio: { icon: Music, brandColor: '#4285F4' },
    archive: { icon: FileArchive, brandColor: '#795548' },
    code: { icon: FileCode, brandColor: '#607D8B' },
    unknown: { icon: File },
}

export function mimeTypeToCategory(mimeType: string, isFolder = false): FileCategory {
    if (isFolder) return 'folder'
    if (mimeType === 'application/pdf') return 'pdf'
    if (mimeType.startsWith('image/')) return 'image'
    if (mimeType.startsWith('video/')) return 'video'
    if (mimeType.startsWith('audio/')) return 'audio'
    if (/document|word|text\/plain/.test(mimeType)) return 'document'
    if (/spreadsheet|excel|text\/csv/.test(mimeType)) return 'spreadsheet'
    if (/presentation|powerpoint/.test(mimeType)) return 'presentation'
    if (/drawing/.test(mimeType)) return 'drawing'
    if (/zip|gzip|tar|compressed/.test(mimeType)) return 'archive'
    if (/text\/javascript|application\/json|text\/html|text\/css/.test(mimeType)) return 'code'
    return 'unknown'
}

export function getFileIcon(category: FileCategory, neutralColor: string): FileIconConfig {
    const entry = fileIconMap[category] ?? { icon: File }
    return { icon: entry.icon, color: entry.brandColor ?? neutralColor }
}

/** Convenience: pick an icon directly from a MIME type. */
export function getFileIconForMime(mimeType: string, neutralColor: string): FileIconConfig {
    return getFileIcon(mimeTypeToCategory(mimeType), neutralColor)
}
