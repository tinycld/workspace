// Pure word/character counting helpers for the document editor.
//
// We use a hand-rolled counter rather than @tiptap/extension-character-count
// because the app shell doesn't ship that extension and pulling it in for
// a single badge isn't worth the dependency footprint. ProseMirror's
// `doc.textContent` flattens the document to a plain string with paragraph
// boundaries already lost — exactly what a "word count" wants. Splitting
// on /\s+/ and filtering empties handles the leading/trailing whitespace
// edges without a regex anchor dance.

export function countWords(text: string): number {
    const trimmed = text.trim()
    if (trimmed === '') return 0
    return trimmed.split(/\s+/).filter(Boolean).length
}

export function countCharacters(text: string): number {
    return text.length
}

// "1 word" / "1,234 words" — the singular case is the one users notice
// when the doc is brand-new and the badge would otherwise read "1 words".
// Thousands separators use the default Intl locale so 12,345 / 12.345 /
// 12 345 all render natively depending on the user's environment; the
// English fixtures below assume an en-US locale.
export function formatWordCount(count: number): string {
    const formatted = count.toLocaleString()
    return count === 1 ? `${formatted} word` : `${formatted} words`
}

export function formatCharacterCount(count: number): string {
    const formatted = count.toLocaleString()
    return count === 1 ? `${formatted} character` : `${formatted} characters`
}
