# @tinycld/text iPad smoke test

Run this on the booted iPad simulator before merging any text PR that touches the WebView editor, the message bus, or the touch UX.

## Setup

1. Boot an iPad simulator:
   ```bash
   xcrun simctl boot 'iPad Pro 13-inch (M4)'
   ```
2. Launch the dev app (`npm run dev` from `~/code/tinycld/tinycld/`). The dev script runs `packages:generate`, which builds the WebView editor bundle as part of its one-shot package-build pass — no manual step needed. If you ever need to rebuild it by hand (e.g. after editing `webview-editor/source/` while dev is already running):
   ```bash
   npx tsx ~/code/tinycld/text/tinycld/text/webview-editor/build.ts
   ```
   Expected output: `[text webview-editor] bundled ~800,000 bytes → build/editorHtml.ts`. The build is gitignored — it lands on disk locally each time dev (or CI) starts.
3. Sign in on iPad. Navigate to the Text app via the rail.

## Open / view a doc

- [ ] Tapping a `.docx` file in the Text list opens the editor within ~2s. No "Loading…" / "Connecting…" stuck state beyond initial WebSocket handshake.
- [ ] No `document.addEventListener is not a function`, no `Unable to resolve react-native-web/dist/exports/InputAccessoryView`, no other bundling errors in the Metro console.
- [ ] The document content renders with formatting preserved (bold, italics, lists, headings).
- [ ] If the doc has images/tables, they render as static content (editing them is v1.1).

## Collaboration

- [ ] Open the same document on iPad AND on a web browser tab.
- [ ] Type on iPad. The new text appears on web within ~1s.
- [ ] Type on web. The new text appears on iPad within ~1s.
- [ ] Web user's cursor shows up on iPad as a colored marker labeled with their name.
- [ ] iPad user's cursor shows up on web as a colored marker labeled with their name.

## Editing via the on-screen keyboard

- [ ] Tap into the document body. iOS soft keyboard appears.
- [ ] The MobileToolbarAccessory bar appears just above the keyboard with: **B** / *I* / U / H1 / H2 / • List / 1. List / ❝
- [ ] Tap **B** while typing — text becomes bold.
- [ ] Tap *I* — text becomes italic.
- [ ] Tap U — text becomes underlined.
- [ ] Tap H1 — current line becomes a heading 1; tapping H1 again removes the heading.
- [ ] Tap • List — current line becomes a bullet item.
- [ ] Tap ❝ — current paragraph becomes a blockquote.
- [ ] Dismiss the keyboard (tap outside). The accessory bar disappears too.

## Formatting via the main DocumentToolbar

- [ ] Bold / italic / underline buttons in the top toolbar work.
- [ ] H1 / H2 / H3 buttons work.
- [ ] Bullet list / ordered list / blockquote buttons work.
- [ ] Undo / Redo buttons work.
- [ ] All toolbar buttons have a 40+pt effective hit target (you don't need to land precisely on the visible icon).

## Links

- [ ] Select some text, tap the link button.
- [ ] LinkPopover modal opens with input field + Cancel/Insert buttons.
- [ ] All buttons have generous touch targets.
- [ ] Type a URL, tap Insert. The selected text becomes a clickable link.
- [ ] Tap an existing link → LinkPopover opens with the current URL prefilled, and a Remove button.

## Read-only access

- [ ] Open the doc as a view-only collaborator (share permission gates this).
- [ ] The document renders normally.
- [ ] The MobileToolbarAccessory's buttons are all visibly disabled (opacity-40).
- [ ] The main DocumentToolbar's buttons are also disabled.
- [ ] Tapping in the document does NOT open the soft keyboard (the WebView's editor is in read-only mode).
- [ ] Other users' cursors still appear in real-time.

## Save status

- [ ] After typing, the SaveStatusIndicator briefly shows "Saving…" then "Saved".
- [ ] If the WebSocket drops, the ReconnectingIndicator appears.

## Performance

- [ ] Initial load of a small doc (1-5 paragraphs) is ~1-2s.
- [ ] Initial load of a larger doc (5+ pages of plain text) is < 5s.
- [ ] Typing latency is < 100ms (no perceptible lag from keystroke to character on screen).
- [ ] Scrolling stays smooth (60fps subjectively).

## Known limitations (NOT failures)

- **Tables and images can be VIEWED but not EDITED** on iPad. Tap on a table cell does nothing; the table editing menu (insert row, etc.) is only wired on web. (v1.1.)
- **The local user appears as TWO collaborators** to remote peers — once for the native room (used for save status / readOnly) and once for the WebView's editor room. (Documented v1.1 fix.)
- **Dark mode**: the WebView's content is light-themed regardless of the host app's color scheme. (Documented v1.1 fix.)
- **Comments**: the `comment-bridge.ts` stub reserves the protocol namespace but no UI yet. Full implementation is v1.1.

## What to do when an item fails

1. Capture a screenshot:
   ```bash
   xcrun simctl io booted screenshot /tmp/ipad-text-fail-<n>.png
   ```
2. Note the Metro console output and any WebView errors (open Safari → Develop → Simulator → attached WebView).
3. File the failure with: item, observed behavior, screenshot path, any errors.

Fixes for failures land per the calc plan's pattern — file a follow-up task and address before merging.
