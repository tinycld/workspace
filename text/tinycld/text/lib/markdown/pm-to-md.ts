// Emits a CommonMark + GFM markdown string from a ProseMirror JSON
// tree. The walker is deliberately hand-rolled rather than going
// through prosemirror-markdown so the supported subset stays small
// and the output is byte-stable across runs (no Set/Map iteration
// surprises, marks always nest in the same order, list indentation
// is fixed).

import {
    MARK_BOLD,
    MARK_CODE,
    MARK_ITALIC,
    MARK_LINK,
    NODE_BLOCKQUOTE,
    NODE_BULLET_LIST,
    NODE_CODE_BLOCK,
    NODE_HEADING,
    NODE_IMAGE,
    NODE_LIST_ITEM,
    NODE_ORDERED_LIST,
    NODE_PAGE_BREAK,
    NODE_PARAGRAPH,
    NODE_TABLE,
    NODE_TABLE_ROW,
    NODE_TEXT,
    type PMMark,
    type PMNode,
} from './types'

// Marks always nest in this order from outside in. Keeping a fixed
// order means a node carrying {bold, italic, link} always serializes
// to `[**_…_**](href)` and never to a permutation.
const MARK_ORDER = [MARK_LINK, MARK_BOLD, MARK_ITALIC, MARK_CODE]

function escapeText(text: string): string {
    // Pragmatic escape set: characters that, if unescaped, would change
    // the parsed structure. Newlines are NOT escaped — they're meaningful
    // (paragraphs are split on blank lines) and the emitter controls
    // them itself.
    return text.replace(/([\\*_`[\]])/g, '\\$1')
}

function wrapCode(text: string): string {
    // If the text contains a backtick we can't use a single-backtick
    // fence — CommonMark requires the surrounding fence length to
    // differ from the longest internal run. The double-backtick form
    // with a leading/trailing space is the common idiom.
    if (text.includes('`')) return `\`\` ${text} \`\``
    return `\`${text}\``
}

function applyMarks(text: string, marks: PMMark[]): string {
    const present = new Map<string, PMMark>()
    for (const m of marks) {
        if (!present.has(m.type)) present.set(m.type, m)
    }

    const hasCode = present.has(MARK_CODE)
    // When `code` is present we MUST not escape the text — code spans
    // render verbatim. Other marks still wrap around it.
    let body = hasCode ? text : escapeText(text)
    if (hasCode) body = wrapCode(body)

    // Apply marks inside-out so the fixed nesting order is preserved.
    // We iterate MARK_ORDER from last (innermost) to first (outermost)
    // and wrap.
    for (let i = MARK_ORDER.length - 1; i >= 0; i--) {
        const type = MARK_ORDER[i]
        if (!present.has(type)) continue
        if (type === MARK_CODE) continue // already applied
        const mark = present.get(type) as PMMark
        if (type === MARK_BOLD) body = `**${body}**`
        else if (type === MARK_ITALIC) body = `*${body}*`
        else if (type === MARK_LINK) {
            const href = (mark.attrs?.href as string | undefined) ?? ''
            body = `[${body}](${href})`
        }
    }
    return body
}

function renderInline(nodes: PMNode[] | undefined): string {
    if (!nodes || nodes.length === 0) return ''
    let out = ''
    for (const node of nodes) {
        if (node.type === NODE_IMAGE) {
            const src = ((node.attrs?.src as string | undefined) ?? '').replace(/\)/g, '%29')
            const alt = (node.attrs?.alt as string | undefined) ?? ''
            out += `![${alt}](${src})`
            continue
        }
        if (node.type !== NODE_TEXT || node.text === undefined) continue
        if (node.text === '\n') {
            out += '  \n'
            continue
        }
        out += applyMarks(node.text, node.marks ?? [])
    }
    return out
}

function indentLines(text: string, prefix: string): string {
    return text
        .split('\n')
        .map(line => (line.length === 0 ? line : prefix + line))
        .join('\n')
}

function renderListItem(item: PMNode, marker: string, indent: string): string {
    const blocks = item.content ?? []
    if (blocks.length === 0) return marker

    const parts: string[] = []
    for (const block of blocks) {
        parts.push(renderBlock(block))
    }

    // First block sits inline after the marker; later blocks are
    // indented to align with the marker's content column.
    const [first, ...rest] = parts
    let out = `${marker}${first}`
    if (rest.length > 0) {
        const tail = rest.map(p => indentLines(p, indent)).join('\n')
        out += `\n${tail}`
    }
    return out
}

function renderBulletList(node: PMNode): string {
    const items = (node.content ?? []).filter(c => c.type === NODE_LIST_ITEM)
    return items.map(item => renderListItem(item, '- ', '  ')).join('\n')
}

function renderOrderedList(node: PMNode): string {
    const items = (node.content ?? []).filter(c => c.type === NODE_LIST_ITEM)
    return items.map(item => renderListItem(item, '1. ', '   ')).join('\n')
}

function renderBlockquote(node: PMNode): string {
    const inner = (node.content ?? []).map(renderBlock).join('\n\n')
    return inner
        .split('\n')
        .map(line => (line.length === 0 ? '>' : `> ${line}`))
        .join('\n')
}

function renderCodeBlock(node: PMNode): string {
    const text = (node.content ?? [])
        .filter(c => c.type === NODE_TEXT && typeof c.text === 'string')
        .map(c => c.text as string)
        .join('')
    return `\`\`\`\n${text}\n\`\`\``
}

function flattenInlineForCell(nodes: PMNode[] | undefined): string {
    // Markdown pipe tables only allow inline content per cell; collapse
    // any embedded newlines (from hard breaks) to single spaces, and
    // escape literal pipes so they don't terminate the cell.
    return renderInline(nodes).replace(/\n/g, ' ').replace(/\|/g, '\\|')
}

function renderTable(node: PMNode): string {
    const rows = (node.content ?? []).filter(c => c.type === NODE_TABLE_ROW)
    if (rows.length === 0) return ''

    const cellTexts = (row: PMNode): string[] =>
        (row.content ?? []).map(cell => flattenInlineForCell(cell.content))

    const header = cellTexts(rows[0])
    const colCount = header.length
    if (colCount === 0) return ''

    const lines: string[] = []
    lines.push(`| ${header.join(' | ')} |`)
    lines.push(`| ${Array.from({ length: colCount }, () => '---').join(' | ')} |`)
    for (let i = 1; i < rows.length; i++) {
        const cells = cellTexts(rows[i])
        // Pad short rows to colCount, truncate long rows — keeps the
        // pipe-table syntactically valid even if the PM tree is ragged.
        while (cells.length < colCount) cells.push('')
        if (cells.length > colCount) cells.length = colCount
        lines.push(`| ${cells.join(' | ')} |`)
    }
    return lines.join('\n')
}

function renderHeading(node: PMNode): string {
    const rawLevel = node.attrs?.level
    let level = typeof rawLevel === 'number' ? Math.floor(rawLevel) : 1
    if (!Number.isFinite(level) || level < 1) level = 1
    if (level > 6) level = 6
    return `${'#'.repeat(level)} ${renderInline(node.content)}`
}

function renderBlock(node: PMNode): string {
    switch (node.type) {
        case NODE_PARAGRAPH:
            return renderInline(node.content)
        case NODE_HEADING:
            return renderHeading(node)
        case NODE_BULLET_LIST:
            return renderBulletList(node)
        case NODE_ORDERED_LIST:
            return renderOrderedList(node)
        case NODE_LIST_ITEM:
            // List items are only meaningful inside a list — if we hit
            // one at the top level, render as a single-item bullet so we
            // don't crash.
            return renderListItem(node, '- ', '  ')
        case NODE_BLOCKQUOTE:
            return renderBlockquote(node)
        case NODE_CODE_BLOCK:
            return renderCodeBlock(node)
        case NODE_TABLE:
            return renderTable(node)
        case NODE_PAGE_BREAK:
            return '---'
        default:
            // Unknown block — emit its inline descendants so we degrade
            // to readable text rather than throwing.
            return renderInline(node.content)
    }
}

export function pmToMarkdown(doc: PMNode): string {
    const blocks = doc.content ?? []
    if (blocks.length === 0) return '\n'
    const rendered = blocks.map(renderBlock).filter(b => b.length > 0)
    return `${rendered.join('\n\n')}\n`
}
