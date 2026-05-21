import { pb } from '@tinycld/core/lib/pocketbase'

export function rewriteCidReferences(
    html: string,
    collectionId: string,
    recordId: string,
    cidMap: Record<string, string> | null | undefined
): string {
    if (!cidMap || Object.keys(cidMap).length === 0) return html
    return html.replace(/(<img[^>]*src=["'])cid:([^"']+)(["'][^>]*>)/gi, (match, prefix, cid, suffix) => {
        const normalized = cid.trim().toLowerCase().replace(/^<|>$/g, '')
        const filename = cidMap[normalized]
        if (!filename) return match
        const url = pb.files.getURL({ collectionId, id: recordId }, filename)
        return `${prefix}${url}${suffix}`
    })
}
