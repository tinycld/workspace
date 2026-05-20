// Pure helpers for MentionInput. Kept out of the component module so
// tests can exercise the logic without pulling react-native (which
// uses Flow syntax that vitest can't parse and only has a small
// shim in tests/unit-setup.ts).

export interface MentionTrigger {
    // Inclusive index of the `@` that opened the autocomplete.
    atIndex: number
    // Caret index, == end of the query being typed.
    caretIndex: number
    // Substring between `@` and caret. May be empty just after typing `@`.
    query: string
}

// Returns the active @-trigger info, or null when the caret isn't
// inside a fresh `@<query>` token. The trigger only fires when `@` is
// at the start of the body or follows whitespace — otherwise typing
// "user@example.com" would auto-open the popover on the email host.
// Bails when the query already contains whitespace — by then the user
// has typed past the mention.
export function detectTrigger(value: string, caretIndex: number): MentionTrigger | null {
    if (caretIndex <= 0 || caretIndex > value.length) return null
    let i = caretIndex - 1
    while (i >= 0) {
        const ch = value[i]
        if (ch === '@') {
            const prev = i > 0 ? value[i - 1] : null
            if (prev !== null && !/\s/.test(prev)) return null
            const query = value.slice(i + 1, caretIndex)
            if (/\s/.test(query)) return null
            return { atIndex: i, caretIndex, query }
        }
        if (/\s/.test(ch)) return null
        i -= 1
    }
    return null
}

// Renders a comment body string with `[[@id]]` tokens replaced by
// `@<displayName>`. Falls back to `@<id>` when the lookup misses
// (the user was removed from the org since the comment was posted).
export function renderMentionsToText(body: string, nameByUserOrgId: Map<string, string>): string {
    return body.replace(/\[\[@([A-Za-z0-9_-]+)\]\]/g, (_, id: string) => {
        const name = nameByUserOrgId.get(id)
        return name ? `@${name}` : `@${id}`
    })
}
