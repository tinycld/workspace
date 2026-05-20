// Help search palette is web-only in v1 — the overlay portals to
// document.body and binds DOM keyboard events that have no analog on
// native. This stub keeps the layout-level
// `import { HelpSearchPalette } from '@tinycld/core/components/help/HelpSearchPalette'`
// resolvable on iOS/Android so the bundler doesn't crash; Metro picks
// up the `.web.tsx` sibling for the actual UI on web.
export function HelpSearchPalette(): null {
    return null
}
