# Handoff: boards URL-driven routing — parked, React #185 (2026-09-07)

**Status: NOT WORKING.** Every deep link crashes the screen with React error
#185 (infinite setState), and 14 boards e2e specs fail because of it. The work
is preserved on the boards branch **`wip/boards-url-routing`** (commit
`b6d52a3`), which holds all five UX items from the original task; the four that
DO work were split out onto `feat/boards-ux-fixes` and are green.

## What this was meant to do

Put the active board in the URL so a board is linkable. Today it lives only in
Zustand (`activeProjectId`, persisted), so a pasted link lands the reader on
whichever board they had open last. The peek rides `?focused=<key>`, a query
param rather than a path.

The intended shape:

| URL | Meaning |
|---|---|
| `/a/boards` | redirect to the last-visited board |
| `/a/boards/PL` | the Product Launch board |
| `/a/boards/PL-12` | that board, card PL-12 peeked |
| `/a/boards/PL/12` | card PL-12, full page |
| `/a/boards/my-cards` | unchanged |

`parseCardKey` (`lib/card-key.ts`) tells the three apart and already existed.
`my-cards` does not parse as a key (one needs digits after the hyphen), and a
15-character PocketBase id has no hyphen — so both fall through to "board"
without a special case.

## The failure

A cold load of `/a/boards/PL-1` renders the error boundary:

```
Error: Minified React error #185
```

That is an infinite `setState` loop. It is reached from the store↔URL sync in
`screens/[boardSlug]/index.tsx` (`useSyncOpenCard`). Four theories were tried
and **all four were wrong** — do not re-try these:

1. **`getId` on the Stack.Screen.** Verified in `@react-navigation/routers`:
   `REPLACE` consults `getId` only to reuse a PRELOADED route, and
   `createRouteFromAction` mints a fresh key via `nanoid()` regardless. `getId`
   is dead code on this path.
2. **`router.setParams` instead of `replace`.** Correct in principle —
   `SET_PARAMS` in `BaseRouter` keeps the route key, so it does avoid the
   remount — but it did not stop the loop.
3. **`useOrgHref` identity.** It *did* return a new closure every render, which
   genuinely makes it unusable in an effect dependency array. Fixed at source
   (hoisted to module scope; shipped separately on core `feat/editor-webview-host`,
   commit `c697b3a`) and the loop **still** reproduces.
4. **The named-vs-resolved card guard.** On a cold load the segment NAMES card 1
   for several renders before the board's cards sync, so the resolved id is `''`
   in that window. Reading that as "no card open" made one effect close the peek
   while the other rewrote the URL to the bare board. A `urlNamesCard` predicate
   narrowed it but did not close it.

## Where to pick it up

**Get a dev-mode repro first.** Every diagnosis above was made from a minified
stack trace, which names no component — that is why four theories cost four
14-minute e2e runs. Run the app with `pnpm run dev` (unminified) and open
`/a/boards/<KEY>-1` directly; React will name the component stuck in the loop.
Do not guess again from the minified trace.

**The constraint the original design encoded, which this work under-weighted:**
`usePeekUrl`'s own doc comment (see it on the WIP branch, or in git history at
`hooks/usePeekUrl.ts`) says plainly that `router.replace` *"REMOUNTS the screen,
taking the peek, the card detail and their editors with it"*. The peek lived in
a **query param** specifically because a param change does not remount, while a
path-segment change does. Any design that moves the peek into the path has to
answer that, and `setParams` is the only primitive found so far that does.

Related: the two-effect adoption dance in `usePeekUrl` (`adoptedRef`,
`lastWrittenRef`) is not incidental complexity — it exists for exactly the
cold-load race in theory 4 above. Deleting it was a mistake; whatever replaces
it needs the same guard.

## What IS reusable on the branch

The plumbing is sound; only the sync is unsound.

- **Route files** — `screens/[boardSlug]/index.tsx` and
  `screens/[boardSlug]/[cardNumber].tsx`. Nested route dirs generate correctly
  (`gen-routes.ts` walks recursively; `calendar/screens/settings/[id].tsx` is
  the existing precedent), and the `"./screens/*"` exports wildcard resolves
  across a slash — verified with `require.resolve`.
- **Pure parsers + their tests** — `parseBoardSegment`, `parseCardNumber`,
  `cardPath`, `boardPath`, `boardSegmentIdentity`, `activeBoardIdFromPath`, and
  `tests/board-route.test.ts` (34 tests). These are all green and independent of
  the loop.
- **`server/urls.go`** — one place for the URL shapes the Go notifications mint,
  replacing two hand-rolled builders that disagreed with each other and both
  omitted the `/a` prefix (they relied on the legacy redirect).
- **`noteVisitedProject`** on the UI store — records the last board WITHOUT
  `setActiveProject`'s side effects (it clears `openCardId`, which closed the
  peek the URL had just opened).

## Backward compatibility, if this is resumed

`?focused=` is an **ecosystem convention, not a boards spelling**.
`core/server/notify/comment_mentions.go` mints `<appURL>/<pkg>?focused=<record>`
generically for every package, and mail, drive and contacts all read it. Every
notification row already written carries it. Boards may stop MINTING it but must
keep ACCEPTING it, or those stored deep links go dead.

## Bugs found and fixed along the way (all shipped separately)

Worth reading before resuming — they were found *by* this work and several are
in the reusable plumbing:

- **The web peek backdrop blocked the whole board.** A full-viewport `Pressable`
  dismissed the peek and made everything behind it dead — clicking another card,
  a column menu, the header. Now built on core's `useOverlayLayer`
  (`core/ui/overlay/layer-stack.ts`), which listens at the document in the
  capture phase without covering anything, and tracks a real layer stack so a
  picker opened inside the peek dismisses only itself. Shipped on
  `feat/boards-ux-fixes`.
- **`useOrgHref` returned a new closure per render.** Shipped on core
  `feat/editor-webview-host` (`c697b3a`).
- **Ordered-list indentation.** Unrelated to routing; shipped in the same core
  commit.
- **Three fragile e2e locators** — a board's name matches both the sidebar entry
  and the board header, so `openBoard`'s `.first()` picked whichever the DOM
  ordered first. Now scoped to the sidebar. Shipped on `feat/boards-ux-fixes`.
