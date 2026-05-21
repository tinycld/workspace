const PALETTE = [
    '#e11d48',
    '#f97316',
    '#eab308',
    '#84cc16',
    '#22c55e',
    '#10b981',
    '#14b8a6',
    '#06b6d4',
    '#3b82f6',
    '#6366f1',
    '#8b5cf6',
    '#a855f7',
    '#d946ef',
    '#ec4899',
    '#f43f5e',
    '#64748b',
]

export function colorForUser(userId: string): string {
    let hash = 0
    for (let i = 0; i < userId.length; i++) {
        hash = (hash << 5) - hash + userId.charCodeAt(i)
        hash |= 0
    }
    const idx = Math.abs(hash) % PALETTE.length
    return PALETTE[idx]
}
