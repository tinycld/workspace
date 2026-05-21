import { EDITOR_CONTENT_STYLES } from '../../lib/editor-content-styles'

// Editor stylesheet kept as a TS string constant. Inlined at runtime
// via a <style> tag injection rather than going through a CSS loader
// in esbuild — avoids needing a separate pipeline step just for this
// one stylesheet and keeps the bundle a single .js artifact that the
// existing scriptTagPattern inliner handles unchanged.
//
// The bulk of the rules (.ProseMirror content styling — headings,
// lists, links, tables, etc.) are shared with the web-side editor via
// EDITOR_CONTENT_STYLES. This file adds the WebView-specific html/body
// wrapper rules and the collaboration-cursor styles, plus hardcoded
// light-mode color fallbacks since the WebView doesn't have the host
// app's CSS variables.
//
// TODO(text-native v1.1): the in-WebView stylesheet hardcodes
// light-mode hex colors. Switching the host app to dark mode
// leaves the editor pane stuck light. To fix:
//   1. Extend InitPayload with `theme: { foreground, background,
//      muted, accent, ... }` (consumed from useThemeColor on the
//      native side).
//   2. Pass theme tokens through the init message.
//   3. Re-render styles.ts as a function of the theme and
//      hot-swap the <style> tag's textContent when the host
//      app's color scheme changes.
export const STYLES = `
:root {
    --editor-foreground: #1a1a1a;
    --editor-muted: #555;
    --editor-border: #ddd;
    --editor-link: #1d4ed8;
    --editor-placeholder: #999;
    --editor-table-header: #f3f4f6;
    --editor-code-bg: #f3f4f6;
    /* Column resize handle + cell selection use the brand primary as
       fallback. The web mount passes the live theme value through
       inline style on the wrapper; here in the WebView we hardcode the
       brand teal (matches the tailwind 'primary' token). */
    --editor-primary-color: #14b8a6;
}
html, body {
    margin: 0;
    padding: 0;
    height: 100%;
    -webkit-user-select: text;
    -webkit-tap-highlight-color: transparent;
}
body {
    background: #fff;
}
#root {
    padding: 16px;
    min-height: 100%;
    box-sizing: border-box;
}
${EDITOR_CONTENT_STYLES}
/* CollaborationCaret styles - peers' cursors and labels */
.collaboration-cursor__caret {
    border-left: 2px solid;
    border-right: 2px solid;
    margin-left: -1px;
    margin-right: -1px;
    pointer-events: none;
    position: relative;
    word-break: normal;
}
.collaboration-cursor__label {
    border-radius: 3px 3px 3px 0;
    color: white;
    font-size: 11px;
    font-style: normal;
    font-weight: 600;
    left: -2px;
    line-height: normal;
    padding: 1px 4px;
    position: absolute;
    top: -18px;
    user-select: none;
    white-space: nowrap;
}
`
