import type { ParsedDriveFile, ParsedDriveFolder, ParsedRecord } from '../types'

const DRIVE_PREFIX = 'Takeout/Drive/'

const MIME_MAP: Record<string, string> = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    txt: 'text/plain',
    csv: 'text/csv',
    json: 'application/json',
    xml: 'text/xml',
    html: 'text/html',
    htm: 'text/html',
    css: 'text/css',
    js: 'text/javascript',
    ts: 'text/typescript',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    mp4: 'video/mp4',
    webm: 'video/webm',
    zip: 'application/zip',
    gz: 'application/gzip',
    md: 'text/markdown',
}

function inferMimeType(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase() || ''
    return MIME_MAP[ext] || 'application/octet-stream'
}

export function parseDriveEntries(entries: Map<string, Uint8Array>): {
    folders: ParsedDriveFolder[]
    files: ParsedDriveFile[]
} {
    const folderPaths = new Set<string>()
    const files: ParsedDriveFile[] = []

    for (const [path, data] of entries) {
        if (!path.startsWith(DRIVE_PREFIX)) continue
        const relativePath = path.slice(DRIVE_PREFIX.length)
        if (!relativePath) continue

        // Skip metadata files Google adds
        if (relativePath.endsWith('-metadata.json')) continue

        if (path.endsWith('/')) {
            // Directory entry
            folderPaths.add(relativePath.replace(/\/$/, ''))
            continue
        }

        // File entry — collect parent directories
        const parts = relativePath.split('/')
        for (let i = 1; i < parts.length; i++) {
            folderPaths.add(parts.slice(0, i).join('/'))
        }

        const parentPath = parts.slice(0, -1).join('/')
        const name = parts[parts.length - 1]

        files.push({
            recordType: 'drive_file',
            path: relativePath,
            name,
            parentPath,
            mime_type: inferMimeType(name),
            size: data.byteLength,
            bytes: new Uint8Array(data).buffer as ArrayBuffer,
        })
    }

    // Sort folders by depth (parents first)
    const sortedFolders = [...folderPaths]
        .filter((p) => p.length > 0)
        .sort((a, b) => a.split('/').length - b.split('/').length)
        .map(
            (path): ParsedDriveFolder => ({
                recordType: 'drive_folder',
                path,
                name: path.split('/').pop() || path,
            })
        )

    return { folders: sortedFolders, files }
}

export function driveRecordsInOrder(folders: ParsedDriveFolder[], files: ParsedDriveFile[]): ParsedRecord[] {
    return [...folders, ...files]
}
