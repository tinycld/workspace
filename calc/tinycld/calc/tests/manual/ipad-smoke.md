# Calc iPad Smoke Test

Run this on the booted iPad simulator before merging any calc PR that touches gesture / native code.

## Setup

1. Boot an iPad simulator:
   ```bash
   xcrun simctl boot 'iPad Pro 13-inch (M4)'
   ```
   (or another iPad model from `xcrun simctl list devices`).
2. Launch the dev app (`pnpm run dev` from `~/code/tinycld/tinycld`).
3. Sign in, navigate to a workspace with a calc workbook.

## Open / navigate

- [ ] Tapping a `.xlsx` file in the calc list opens the spreadsheet within 2s. No "Loading…" / "Opening…" stuck state.
- [ ] No `document.addEventListener is not a function` error in the Metro console.
- [ ] Switching sheets via the bottom tab bar works.
- [ ] Long-pressing a sheet tab opens the SheetTabContextMenu at the touch point (not in the screen corner).

## Selection

- [ ] Tapping a cell selects it — visible green border on the active cell.
- [ ] Dragging from cell A1 to C3 selects the rectangle (green tint on cells inside the range).
- [ ] After selecting a rectangle, four small green corner handles appear on the bounding rect.
- [ ] Dragging the bottom-right corner handle extends the selection rectangle to the cell under the finger.
- [ ] Dragging any other corner handle also extends correctly.

## Edit

- [ ] Double-tap a cell opens the editor (or tap-then-tap if double-tap doesn't fire).
- [ ] Soft keyboard appears with the calc accessory bar above it. The accessory bar shows: `Esc` `▲` `▼` `Tab` `Enter` `fx`.
- [ ] Tap `Tab` on accessory bar → focus moves to the next cell to the right; cell value commits.
- [ ] Tap `Enter` on accessory bar → focus moves to the next cell below; cell value commits.
- [ ] Tap `Esc` on accessory bar → edit cancels; cell shows the prior value.
- [ ] During a formula edit (type `=`), tap a different cell. The tapped cell's A1 address inserts into the formula at the cursor (e.g. typing `=` then tapping B3 → `=B3`).
- [ ] Tapping another cell mid-formula REPLACES the inserted ref (cursor is still in the ref position).

## Context menus

- [ ] Long-press a cell opens CellContextMenu at the touch point (Cut / Copy / Paste / Insert / Delete / Comment / Freeze / Sort / Filter).
- [ ] Long-press a row number opens HeaderContextMenu (Insert row above/below / Delete row / Resize-to-fit).
- [ ] Long-press a column letter opens HeaderContextMenu (Insert column left/right / Delete column / Resize-to-fit).
- [ ] Long-press the fill handle (small green square at the selection's bottom-right corner) does NOT open a menu — that's a drag gesture, not a press.

## Fill handle

- [ ] Select a cell with a value or formula. A small green square appears at the bottom-right.
- [ ] Drag the green square down 3 cells. On release, the value/formula copies (autofills) down.
- [ ] The hit target around the visible 8×8 green square is ~32×32 (you don't need to land precisely on the visible square; a finger near it should still grab it).

## CSV

- [ ] Open the toolbar's CSV download item (File menu → Download CSV, or wherever it lives on iPad).
- [ ] The iOS share sheet appears with the CSV file ready to save to Files, AirDrop, mail, etc.

## Print

- [ ] Toolbar → Print opens the print dialog.
- [ ] Preview renders correctly.
- [ ] "Print" routes to iOS's native print sheet.

## Dialogs

- [ ] Find/Replace dialog opens, accepts input, navigates matches (prev/next chevrons work and have generous touch targets).
- [ ] Sort dialog opens; tapping a column header sorts the range; A↔Z toggle has a generous touch target.
- [ ] Filter dropdown on a column header opens, presents the value list, applies on confirm.
- [ ] Conditional formatting drawer slides in from the side (web has a side panel; verify iPad equivalent).
- [ ] Insert → Function inserts the function name into the active cell.

## Realtime collaboration

- [ ] Open the same workbook on a web browser. Type a value in a cell on iPad.
- [ ] The value appears on web within ~1s.
- [ ] Conversely, type a value on web; appears on iPad within ~1s.
- [ ] Other users' cursors render as colored cell borders on iPad.

## Undo / redo

- [ ] Type a value in a cell. Long-press elsewhere and choose Undo (if available in the long-press menu) — value reverts.
- [ ] Redo restores. (Native lacks Cmd-Z; the menu path or a toolbar button is the entry.)

## Performance

- [ ] Scrolling a 50×26 sheet stays smooth (60fps subjectively).
- [ ] Typing a value commits within ~100ms of pressing Enter (no perceptible delay).

## What to do when an item fails

1. Capture a screenshot:
   ```bash
   xcrun simctl io booted screenshot /tmp/ipad-calc-fail-<n>.png
   ```
2. Note the Metro console for any errors.
3. File the failure with: which item, what you observed, screenshot path, any stack trace.

The fix tail for failures is in Task 6.2 of the calc-native-support plan (`~/Documents/plans/2026-05-14-calc-native-support.md`).

## Known limitations (not failures — expected behavior)

- **Disjoint selection (Ctrl-click on web) doesn't exist on iPad** — no equivalent gesture. Long-press a column letter to delete or insert at that one column.
- **Shift-click extend doesn't exist on iPad** — use the corner drag handles on the active selection instead.
- **Mid-drag Shift toggle for the fill handle** (extend mode) doesn't exist on iPad — fill is always copy-mode. To extend a selection, use the corner handles.
- **Keyboard shortcuts dialog is hidden on iPad** — there's no hardware-keyboard discoverability layer to surface.
