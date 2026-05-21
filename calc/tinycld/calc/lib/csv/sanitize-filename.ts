// Filesystem-safe filename: replaces characters disallowed by macOS /
// Windows / Linux with underscore, collapses runs, and trims edge
// underscores. Browser download dialogs already coerce some of these
// but the native (expo-file-system) write path needs it cleaned first.
export function sanitizeFilename(name: string): string {
    const cleaned = name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
    return cleaned.replace(/_+/g, '_').replace(/^_|_$/g, '') || 'sheet'
}
