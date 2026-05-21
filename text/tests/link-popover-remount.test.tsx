// LinkPopover used to re-sync its form state from `initialUrl` on each
// open transition with a useState + useEffect dance — the kind of
// pattern that ships with a `biome-ignore lint/correctness/useExhaustiveDependencies`
// comment because the effect deliberately omits one of its inputs.
// That comment is the tell: the state is being kept in two places
// (React state + props) and a manual effect bridges them.
//
// The replacement is a `<LinkPopoverContents key={...} />` remount —
// React's reconciler unmounts the inner form whenever the key changes,
// so the next render's `useState(initialUrl)` initialiser sees the
// fresh seed. No effect needed. The biome-ignore goes away.
//
// The component itself is React Native (View / TextInput / Modal) and
// can't render under vitest's node environment — same constraint as
// every other RN-styled component in this package. What we DO lock
// here is the pure key derivation: a fresh open with a different
// initialUrl must produce a different key string than the prior open,
// so React's reconciler triggers the remount that does the work.

import { describe, expect, it } from 'vitest'
import { linkPopoverContentsKey } from '../tinycld/text/components/link-popover-key'

describe('linkPopoverContentsKey', () => {
    it('returns a different key when the popover transitions from closed to open', () => {
        // The most common path: the popover was closed (or being
        // unmounted), now opens with the current selection's link.
        // The change in `isOpen` alone forces a remount even if the
        // URL happens to be the same as the previous session.
        const closed = linkPopoverContentsKey(false, 'https://example.com')
        const opened = linkPopoverContentsKey(true, 'https://example.com')
        expect(closed).not.toBe(opened)
    })

    it('returns a different key when initialUrl changes while the popover is already open', () => {
        // Less common but load-bearing: the user clicks one link, the
        // popover opens with its href; without closing, they click a
        // different link in the editor. The caller updates initialUrl
        // and the inner form must re-seed to show the new href —
        // otherwise it would keep displaying whatever the user typed
        // for the previous link.
        const a = linkPopoverContentsKey(true, 'https://first.example')
        const b = linkPopoverContentsKey(true, 'https://second.example')
        expect(a).not.toBe(b)
    })

    it('returns the same key for the same inputs (stable identity)', () => {
        // Idempotence: a render that produces the same inputs must
        // produce the same key so React does NOT remount on every
        // parent render — that would drop the user's in-progress
        // typing back to initialUrl on every keystroke elsewhere.
        const first = linkPopoverContentsKey(true, 'https://example.com')
        const second = linkPopoverContentsKey(true, 'https://example.com')
        expect(first).toBe(second)
    })

    it('treats empty-string initialUrl as a distinct seed', () => {
        // initialUrl="" is the "Insert link from scratch" case. The
        // key still has to differ from the closed-with-empty-url key
        // so the form mounts fresh.
        expect(linkPopoverContentsKey(false, '')).not.toBe(linkPopoverContentsKey(true, ''))
    })

    it('distinguishes URLs that share a prefix', () => {
        // Defensive: the join character mustn't collide with URL
        // contents (otherwise "true-https://a" and a hypothetical
        // "true" + "-https://a" would clash). Both inputs here yield
        // distinct keys regardless of the join glyph chosen.
        const a = linkPopoverContentsKey(true, 'https://example.com')
        const b = linkPopoverContentsKey(true, 'https://example.com/page')
        expect(a).not.toBe(b)
    })
})

// Integration contract: how LinkPopover uses linkPopoverContentsKey.
//
// The parent component renders <Modal> → <LinkPopoverContents
//   key={linkPopoverContentsKey(isOpen, initialUrl)} initialUrl=... />.
//
// React's reconciler treats two same-position children with different
// keys as different elements and unmounts/remounts. That remount
// resets every useState inside LinkPopoverContents back to its
// initialiser, which reads `initialUrl` — the new URL becomes the
// visible input value, even if the user had typed something else
// during the previous open.
//
// The closed case (isOpen=false) is additionally guarded by the
// parent returning null, so the inner form unmounts on close anyway.
// The key is the additional belt-and-braces in case a future refactor
// keeps the inner mounted across opens.
describe('LinkPopover remount contract', () => {
    it('opening with a new initialUrl yields a fresh key vs the previous open with edited text', () => {
        // Scenario from the PR description: user opens the popover on
        // link A, types something else into the input but cancels.
        // They click link B in the doc — the popover re-opens with
        // link B's href as initialUrl. The key must differ from the
        // first open, so the inner form remounts and the typed text
        // is discarded in favour of link B's seed.
        const firstOpen = linkPopoverContentsKey(true, 'https://first.example')
        // (interim close — parent returns null, key during the close is
        // identical to firstOpen's "open" key for the sake of this test.)
        const secondOpen = linkPopoverContentsKey(true, 'https://second.example')
        expect(firstOpen).not.toBe(secondOpen)
    })

    it('re-opening with the same initialUrl after a close yields a remount via the isOpen flip', () => {
        // Subtle but important: even if the user closes and re-opens
        // on the SAME link, the inner form should reset (their typed
        // changes from the first session were cancelled). The
        // parent's null-return on close handles this in the current
        // implementation; the key axis is the defensive layer for any
        // future refactor that keeps the inner mounted.
        const open = linkPopoverContentsKey(true, 'https://example.com')
        const closed = linkPopoverContentsKey(false, 'https://example.com')
        expect(open).not.toBe(closed)
    })
})
