export function formatBytes(bytes: number): string {
    if (bytes === 0) return '—'
    const units = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(1024))
    const value = bytes / 1024 ** i
    return `${value.toFixed(i > 0 ? 1 : 0)} ${units[i]}`
}

export function formatDate(isoDate: string): string {
    const date = new Date(isoDate)
    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    })
}

export function formatRelativeDate(isoDate: string): string {
    if (!isoDate) return ''

    const date = new Date(isoDate)
    const now = new Date()

    if (Number.isNaN(date.getTime())) return isoDate

    const isToday =
        date.getFullYear() === now.getFullYear() &&
        date.getMonth() === now.getMonth() &&
        date.getDate() === now.getDate()

    if (isToday) {
        return date.toLocaleTimeString(undefined, {
            hour: 'numeric',
            minute: '2-digit',
        })
    }

    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    const isYesterday =
        date.getFullYear() === yesterday.getFullYear() &&
        date.getMonth() === yesterday.getMonth() &&
        date.getDate() === yesterday.getDate()

    if (isYesterday) return 'Yesterday'

    if (date.getFullYear() === now.getFullYear()) {
        return date.toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
        })
    }

    return date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    })
}
