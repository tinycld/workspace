import type { BaseCommentRow, Thread } from './types'

// groupCommentsByKey partitions a flat row list by a caller-supplied key
// function. Each package provides its own anchor key (cellKey for calc,
// commentId for text) so the same helper works without baking anchor
// shape into core.
export function groupCommentsByKey<R extends BaseCommentRow>(
    rows: R[],
    keyFn: (row: R) => string
): Map<string, R[]> {
    const out = new Map<string, R[]>()
    for (const r of rows) {
        const key = keyFn(r)
        const bucket = out.get(key)
        if (bucket) {
            bucket.push(r)
        } else {
            out.set(key, [r])
        }
    }
    return out
}

// buildThreads collects the rows for one anchor into per-thread groups.
// A row with empty parent_comment is a root; rows whose parent_comment
// matches a known root id are appended as replies in created order.
// Orphan replies (parent missing or unknown) are skipped — better to
// hide a stray reply than render it without context.
export function buildThreads<R extends BaseCommentRow>(rowsForAnchor: R[]): Thread<R>[] {
    const sorted = [...rowsForAnchor].sort(compareByCreated)
    const threads = new Map<string, Thread<R>>()
    for (const r of sorted) {
        if (!r.parent_comment) {
            threads.set(r.id, {
                root: r,
                replies: [],
                resolvedAt: r.resolved_at ? r.resolved_at : null,
            })
        }
    }
    for (const r of sorted) {
        if (!r.parent_comment) continue
        const t = threads.get(r.parent_comment)
        if (!t) continue
        t.replies.push(r)
    }
    return Array.from(threads.values()).sort((a, b) => compareByCreated(a.root, b.root))
}

// hasUnresolvedThreads returns true iff at least one thread on the anchor
// has resolved_at == null. Indicator subscribers call this per-anchor so
// a resolve hides the indicator on the next render.
export function hasUnresolvedThreads<R extends BaseCommentRow>(
    rowsForAnchor: R[] | undefined
): boolean {
    if (!rowsForAnchor || rowsForAnchor.length === 0) return false
    for (const r of rowsForAnchor) {
        if (r.parent_comment) continue
        if (!r.resolved_at) return true
    }
    return false
}

function compareByCreated(a: BaseCommentRow, b: BaseCommentRow): number {
    if (a.created < b.created) return -1
    if (a.created > b.created) return 1
    if (a.id < b.id) return -1
    if (a.id > b.id) return 1
    return 0
}
