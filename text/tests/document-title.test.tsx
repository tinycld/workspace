// DocumentTitle is a React Native component (Pressable / TextInput
// from 'react-native') styled with Uniwind, so it can't be mounted
// under the project's node-env vitest setup — same constraint as
// ImportWarningBanner, see import-warning-banner.test.tsx.
//
// What we DO unit-test is the pure decision logic in
// document-title-edit.ts: resolveCommit drives every UX rule the
// inline editor implements (Escape vs Enter vs blur, empty input,
// unchanged-name short-circuit). The component is a thin shell over
// that helper plus the useRenameDocument mutation hook, so locking
// the helper's contract is what catches behavioural regressions in
// the title editor without needing jsdom.

import { describe, expect, it } from 'vitest'
import {
    EMPTY_NAME_ERROR,
    RENAME_FAILED_ERROR,
    resolveCommit,
} from '../tinycld/text/components/document-title-edit'

describe('resolveCommit', () => {
    it('returns submit with the trimmed name when the user types something new', () => {
        // Maps the "Enter with a different name fires the mutation"
        // behaviour the component test plan calls out — the trimmed
        // value is what we hand to rename().
        const outcome = resolveCommit('  My new doc  ', 'Untitled.docx')
        expect(outcome).toEqual({ type: 'submit', trimmedName: 'My new doc' })
    })

    it('returns a noop when the value matches the current name', () => {
        // "Enter with the same name does NOT fire" — equality check is
        // after trim on both sides so a stray trailing space doesn't
        // trigger a spurious write.
        const outcome = resolveCommit('Untitled.docx', 'Untitled.docx')
        expect(outcome).toEqual({ type: 'noop', reason: 'unchanged' })
    })

    it('treats whitespace-padded equality as unchanged', () => {
        const outcome = resolveCommit('   Untitled.docx   ', 'Untitled.docx')
        expect(outcome).toEqual({ type: 'noop', reason: 'unchanged' })
    })

    it('returns a noop with reason "empty" for an empty string', () => {
        const outcome = resolveCommit('', 'Untitled.docx')
        expect(outcome).toEqual({ type: 'noop', reason: 'empty' })
    })

    it('returns a noop with reason "empty" for whitespace-only input', () => {
        // Whitespace-only is rejected the same as empty — otherwise
        // the user could end up with a "        " filename and no
        // way to recognise it in lists.
        const outcome = resolveCommit('   \t  ', 'Untitled.docx')
        expect(outcome).toEqual({ type: 'noop', reason: 'empty' })
    })

    it('distinguishes empty from unchanged when the current name itself is empty', () => {
        // Defensive: drive_items.name should never be empty, but if
        // it ever is, an empty draft is "empty" (rejected) not
        // "unchanged" (silent noop). The empty-check fires first.
        const outcome = resolveCommit('', '')
        expect(outcome).toEqual({ type: 'noop', reason: 'empty' })
    })

    it('exposes stable error copy for the empty-input case', () => {
        // Centralising the copy in the helper means a future change
        // to the visible string breaks the unit test instead of
        // shipping a silent regression to users.
        expect(EMPTY_NAME_ERROR).toMatch(/empty/i)
    })

    it('exposes stable error copy for mutation failure', () => {
        expect(RENAME_FAILED_ERROR).toMatch(/rename/i)
    })
})

describe('DocumentTitle integration contract', () => {
    // These cases describe how the component USES resolveCommit. The
    // component is React Native so we can't mount it under vitest,
    // but we can describe the wiring as plain-language assertions
    // against the helper output so a refactor that breaks them is
    // visible.
    //
    // (a) Clicking the title switches to edit mode:
    //     onPress => setIsEditing(true) when not read-only / pending.
    //     The Pressable's `disabled={isReadOnly || isPending}` gates
    //     this; no helper involvement — verified by Playwright.
    //
    // (b) Escape cancels without firing the mutation:
    //     onKeyPress with key 'Escape' calls exitWithoutSubmitting,
    //     which never calls rename. Helper not exercised — see (b)
    //     test below for the parallel "blur with same value" case
    //     which DOES go through the helper.
    //
    // (c) Enter with a different name fires the mutation:
    //     handleCommit calls resolveCommit; submit outcome triggers
    //     rename(trimmedName).
    it('Enter with new name yields a submit outcome the component hands to rename()', () => {
        const outcome = resolveCommit('Renamed', 'Untitled.docx')
        expect(outcome.type).toBe('submit')
        if (outcome.type === 'submit') {
            expect(outcome.trimmedName).toBe('Renamed')
        }
    })

    //     (d) Enter with the same name does NOT fire:
    it('Enter with same name yields a noop the component treats as cancel', () => {
        const outcome = resolveCommit('Untitled.docx', 'Untitled.docx')
        expect(outcome.type).toBe('noop')
    })

    //     (e) Read-only mode disables the click handler:
    //         The Pressable's `disabled` is wired off isReadOnly; the
    //         helper isn't even called in that branch. Documented
    //         here so a future refactor that moves the gate into the
    //         helper has to update the test.
    it('read-only gating is component-level (resolveCommit is unaware of read-only)', () => {
        // The helper would happily resolve a rename in read-only
        // mode — the component is responsible for never CALLING it.
        // This is a structural assertion; if someone moves the gate
        // into the helper they should refactor the helper signature
        // to accept it explicitly, and this test breaks first.
        const outcome = resolveCommit('Anything', 'Untitled.docx')
        expect(outcome).toEqual({ type: 'submit', trimmedName: 'Anything' })
    })
})
