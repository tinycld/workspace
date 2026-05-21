// Pure helpers behind the inline document-title editor. Component
// code (DocumentTitle.tsx) is JSX-heavy and can't be mounted under
// the project's node-env vitest setup, so the decision logic lives
// here as a small total function the tests exercise directly.

export type CommitOutcome =
    | { type: 'noop'; reason: 'unchanged' | 'empty' }
    | { type: 'submit'; trimmedName: string }

// resolveCommit decides what should happen when the user "commits" an
// inline rename (Enter, or blur).
//
//   - Empty / whitespace-only input is a noop: the caller restores the
//     original name and may surface an inline error. Trim-then-test
//     means "   " is treated the same as "".
//   - A name that equals the current name (after trim) is a noop:
//     submitting would optimistically write the same value, and the
//     "skip if equal" rule is part of the data spec.
//   - Otherwise we return the trimmed string the caller should hand
//     to the rename mutation.
export function resolveCommit(rawInput: string, currentName: string): CommitOutcome {
    const trimmed = rawInput.trim()
    if (trimmed.length === 0) {
        return { type: 'noop', reason: 'empty' }
    }
    if (trimmed === currentName.trim()) {
        return { type: 'noop', reason: 'unchanged' }
    }
    return { type: 'submit', trimmedName: trimmed }
}

// Empty-input error copy the title shows briefly after the user
// tries to commit a blank rename. Centralised so tests + UI agree.
export const EMPTY_NAME_ERROR = 'Name cannot be empty'

// Generic mutation-failure copy. Sentry receives the real error via
// captureException; users see a short inline string instead of the
// raw message (which can be a stack-y server response).
export const RENAME_FAILED_ERROR = "Couldn't rename — try again"
