// Parses a CommonMark + GFM markdown string into a ProseMirror JSON
// tree that matches the editor schema (see types.ts). The walker
// consumes markdown-it's token stream directly rather than going
// through the HTML renderer — this keeps the conversion deterministic
// and lets us drop unsupported constructs (raw HTML, footnotes, etc.)
// to plain paragraphs without ever materializing the intermediate HTML.

import MarkdownIt from 'markdown-it'
import type Token from 'markdown-it/lib/token.mjs'
import {
    MARK_BOLD,
    MARK_CODE,
    MARK_ITALIC,
    MARK_LINK,
    NODE_BLOCKQUOTE,
    NODE_BULLET_LIST,
    NODE_CODE_BLOCK,
    NODE_DOC,
    NODE_HEADING,
    NODE_IMAGE,
    NODE_LIST_ITEM,
    NODE_ORDERED_LIST,
    NODE_PAGE_BREAK,
    NODE_PARAGRAPH,
    NODE_TABLE,
    NODE_TABLE_CELL,
    NODE_TABLE_ROW,
    NODE_TEXT,
    type PMMark,
    type PMNode,
} from './types'

// One-shot parser instance — markdown-it is stateless across parse()
// calls so we don't need to re-build it per invocation.
const md = new MarkdownIt({ html: false, linkify: true, typographer: false })

// Open-tag tokens map to a PM node type with no special handling
// beyond pushing a new container onto the walker's stack. The matching
// `_close` token pops the container.
const OPEN_TO_NODE: Record<string, string> = {
    paragraph_open: NODE_PARAGRAPH,
    bullet_list_open: NODE_BULLET_LIST,
    ordered_list_open: NODE_ORDERED_LIST,
    list_item_open: NODE_LIST_ITEM,
    blockquote_open: NODE_BLOCKQUOTE,
    table_open: NODE_TABLE,
    tr_open: NODE_TABLE_ROW,
    th_open: NODE_TABLE_CELL,
    td_open: NODE_TABLE_CELL,
}

// Pass-through containers — we walk through their children but emit no
// node of our own (thead/tbody are GFM structural wrappers the schema
// doesn't model).
const PASSTHROUGH_OPEN = new Set(['thead_open', 'thead_close', 'tbody_open', 'tbody_close'])

function cloneMarks(marks: PMMark[]): PMMark[] {
    return marks.map(m => ({ type: m.type, ...(m.attrs ? { attrs: { ...m.attrs } } : {}) }))
}

function textNode(text: string, marks: PMMark[]): PMNode {
    const node: PMNode = { type: NODE_TEXT, text }
    if (marks.length > 0) node.marks = cloneMarks(marks)
    return node
}

// Convert an `inline` token's `.children` stream into a flat array of
// PMNodes (text + image). Marks are tracked on a stack so nested
// strong/em/code/link compose correctly.
function walkInline(children: Token[]): PMNode[] {
    const out: PMNode[] = []
    const markStack: PMMark[] = []

    for (const token of children) {
        switch (token.type) {
            case 'text':
                if (token.content.length > 0) out.push(textNode(token.content, markStack))
                break
            case 'softbreak':
                out.push(textNode(' ', markStack))
                break
            case 'hardbreak':
                out.push(textNode('\n', markStack))
                break
            case 'strong_open':
                markStack.push({ type: MARK_BOLD })
                break
            case 'strong_close':
                popMark(markStack, MARK_BOLD)
                break
            case 'em_open':
                markStack.push({ type: MARK_ITALIC })
                break
            case 'em_close':
                popMark(markStack, MARK_ITALIC)
                break
            case 'code_inline':
                // The PM `code` mark is exclusive — StarterKit declares it
                // with `excludes: '_'`, which forbids any other mark on the
                // same text node. Markdown does allow `[a `b` c](url)` etc.,
                // so we silently drop competing marks from the stack here
                // rather than emit a (link, code) tuple that makes
                // ProseMirror reject the whole insertContent with
                // "Invalid collection of marks for node text: link,code".
                out.push(textNode(token.content, [{ type: MARK_CODE }]))
                break
            case 'link_open': {
                const href = token.attrGet('href') ?? ''
                markStack.push({ type: MARK_LINK, attrs: { href } })
                break
            }
            case 'link_close':
                popMark(markStack, MARK_LINK)
                break
            case 'image': {
                const src = token.attrGet('src') ?? ''
                if (src.length === 0) break
                const alt = token.content || token.attrGet('alt') || null
                out.push({ type: NODE_IMAGE, attrs: { src, alt } })
                break
            }
            default:
                // Unknown inline token — surface its literal content as
                // text so users at least see something readable.
                if (token.content) out.push(textNode(token.content, markStack))
                break
        }
    }

    return out
}

function popMark(stack: PMMark[], type: string): void {
    for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].type === type) {
            stack.splice(i, 1)
            return
        }
    }
}

export function markdownToPM(markdown: string): PMNode {
    if (markdown.length === 0) return { type: NODE_DOC, content: [] }
    const tokens = md.parse(markdown, {})
    return walkBlocks(tokens)
}

// A top-level block paired with the markdown source that produced it.
// Returned by markdownToPMBlocks so callers (notably Edit → Paste as
// Markdown) can insert blocks individually and, on schema-rejection,
// fall back to inserting the original source as a plain paragraph
// without throwing away the rest of the paste.
export interface MarkdownBlock {
    block: PMNode
    source: string
}

// Variant of markdownToPM that returns each top-level block paired
// with the slice of the original markdown that produced it. Source
// slicing uses markdown-it's `token.map` line range — present on every
// top-level block token (paragraph, heading, list, blockquote, table,
// fence, code_block, hr). If a block somehow lacks `.map` we fall
// back to an empty source string; the caller treats an empty source as
// "no plaintext fallback available" and skips it.
//
// Nested blocks (a paragraph inside a list item) are still walked as
// children of their parent block — only the outermost block has a
// source slice attached. That keeps the salvage granularity at the
// level a reader of the markdown source would call a "block."
export function markdownToPMBlocks(markdown: string): MarkdownBlock[] {
    if (markdown.length === 0) return []
    const tokens = md.parse(markdown, {})
    const lines = markdown.split('\n')
    const out: MarkdownBlock[] = []

    // Sub-walk one top-level block: a slice of `tokens` from a top-level
    // open token through its matching close token. We don't want to
    // re-implement the full nested walker — instead, build a single-block
    // doc from this slice using the same walkBlocks() helper, then
    // unwrap the one block out of the resulting doc.
    let i = 0
    while (i < tokens.length) {
        const token = tokens[i]
        // Skip passthrough opens at the top level (thead/tbody only
        // appear inside table, never as outermost block).
        if (PASSTHROUGH_OPEN.has(token.type)) {
            i++
            continue
        }
        // Top-level block tokens always have nesting >= 0 and a map.
        // Anything else (closes, inline children, …) shouldn't appear
        // at the outer iteration of the original walker, but we guard
        // against malformed token streams by skipping unrecognized
        // non-block tokens.
        if (token.nesting < 0) {
            i++
            continue
        }
        const startTokenIndex = i
        const endTokenIndex = findBlockEnd(tokens, i)
        const slice = tokens.slice(startTokenIndex, endTokenIndex + 1)
        const subDoc = walkBlocks(slice)
        const subBlocks = subDoc.content ?? []
        const map = token.map ?? null
        const source =
            map !== null && map.length === 2
                ? lines.slice(map[0], map[1]).join('\n')
                : ''
        for (const block of subBlocks) out.push({ block, source })
        i = endTokenIndex + 1
    }

    return out
}

// Find the matching close token for an opening container token at
// `start`. For self-contained tokens (`fence`, `code_block`, `hr`,
// `inline`) the start *is* the end. For nested containers we track
// depth on the same tag name.
function findBlockEnd(tokens: Token[], start: number): number {
    const open = tokens[start]
    if (open.nesting === 0) return start
    const closeType = `${open.type.slice(0, -'_open'.length)}_close`
    let depth = 1
    for (let j = start + 1; j < tokens.length; j++) {
        if (tokens[j].type === open.type) depth++
        else if (tokens[j].type === closeType) {
            depth--
            if (depth === 0) return j
        }
    }
    // Unbalanced — defensive: treat the rest of the stream as belonging
    // to this block rather than raising. markdown-it is supposed to
    // always emit balanced opens/closes; if that contract ever breaks,
    // we'd rather salvage than throw.
    return tokens.length - 1
}

// Core walker shared by markdownToPM and markdownToPMBlocks. Consumes
// a markdown-it token stream and produces a single PM doc node.
function walkBlocks(tokens: Token[]): PMNode {
    const root: PMNode = { type: NODE_DOC, content: [] }
    // Container stack: the current open node is always stack[stack.length-1].
    const stack: PMNode[] = [root]

    const push = (node: PMNode): void => {
        const parent = stack[stack.length - 1]
        if (!parent.content) parent.content = []
        parent.content.push(node)
    }

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i]
        const type = token.type

        if (PASSTHROUGH_OPEN.has(type)) continue

        // Heading is special because it carries a level attr.
        if (type === 'heading_open') {
            const level = parseInt(token.tag.slice(1), 10) || 1
            const node: PMNode = { type: NODE_HEADING, attrs: { level }, content: [] }
            push(node)
            stack.push(node)
            continue
        }
        if (type === 'heading_close') {
            stack.pop()
            continue
        }

        // Generic open/close handling for paragraph/list/table-row/etc.
        const mapped = OPEN_TO_NODE[type]
        if (mapped !== undefined) {
            const node: PMNode = { type: mapped, content: [] }
            push(node)
            stack.push(node)
            continue
        }
        if (type.endsWith('_close') && OPEN_TO_NODE[`${type.slice(0, -6)}_open`] !== undefined) {
            stack.pop()
            continue
        }

        if (type === 'inline') {
            const children = token.children ?? []
            for (const child of walkInline(children)) push(child)
            continue
        }

        if (type === 'fence' || type === 'code_block') {
            // markdown-it includes a trailing newline on fence content; strip one.
            const raw = token.content.endsWith('\n') ? token.content.slice(0, -1) : token.content
            const code: PMNode = {
                type: NODE_CODE_BLOCK,
                content: raw.length > 0 ? [{ type: NODE_TEXT, text: raw }] : [],
            }
            push(code)
            continue
        }

        if (type === 'hr') {
            push({ type: NODE_PAGE_BREAK })
            continue
        }

        // Unknown block — emit a paragraph carrying the raw content so
        // the user sees their input rather than silent loss.
        if (token.nesting === 0 && token.content) {
            push({
                type: NODE_PARAGRAPH,
                content: [{ type: NODE_TEXT, text: token.content }],
            })
        }
    }

    return root
}
