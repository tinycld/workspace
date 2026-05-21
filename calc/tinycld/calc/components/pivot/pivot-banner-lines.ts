// Pure message-mapping for PivotBanner. Lives in its own .ts module
// (no React Native imports) so unit tests can assert against it
// without the test-transformer choking on react-native's Flow types
// — our vitest setup runs in a node environment and mocks
// `react-native`, but the mock applies at runtime, not during the
// Rollup parse phase. Keeping the helper RN-free sidesteps that.

import type { PivotError } from '../../lib/pivot'

export interface PivotBannerLines {
    title: string
    body: string
}

// The engine owns per-code wording (see lib/pivot/source-read.ts and
// lib/pivot/index.ts) — the banner only displays it. The title is
// fixed so it's the same shouty header regardless of which code we
// got back; the body is the error's `message` verbatim.
export function bannerLinesFor(error: PivotError): PivotBannerLines {
    return {
        title: "Pivot table can't render",
        body: error.message,
    }
}
