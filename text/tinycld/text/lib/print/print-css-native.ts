import { buildTextPrintCssWeb } from './print-css-web'

// buildTextPrintCssNative is the print stylesheet handed to
// expo-print on iOS / Android. expo-print runs the HTML inside a
// system WebView with no fonts available beyond the platform
// defaults and no network access for external assets — the calling
// code is responsible for `images=embed` so the fragment carries
// data: URIs rather than `<img src=https://…>`.
//
// For now we share the web rule set verbatim: the `tinycld-text*`
// class vocabulary is identical and the rules don't rely on any
// web-only features. If a divergence becomes necessary (iOS Safari's
// @page support is narrower than desktop Chrome's), this is the
// seam to break them apart.
export function buildTextPrintCssNative(): string {
    return buildTextPrintCssWeb()
}
