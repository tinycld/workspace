import type { PrintConfig } from './types'
import { buildPrintCss as buildPrintCssWeb } from './print-css.web'

// buildPrintCss (native) is the print stylesheet handed to expo-print
// on iOS/Android. expo-print runs the HTML inside a system WebView
// with no fonts available beyond the platform defaults and no
// network access for external assets — the calling code is
// responsible for `images=embed` so the fragment carries data: URIs
// rather than `<img src=https://…>`.
//
// For the time being we share the web rule set verbatim: the
// `tinycld-calc*` class vocabulary is identical and the rules don't
// rely on any web-only features. If a divergence becomes necessary
// (e.g. iOS Safari's @page support is narrower), this is the seam
// to break them apart.
export function buildPrintCss(config: PrintConfig): string {
    return buildPrintCssWeb(config)
}
