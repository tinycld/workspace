import { Platform } from 'react-native'
import { AnchoredOverlayController } from '../lib/anchored-overlay/anchored-overlay-controller'
import { SlashMenuPopover } from './SlashMenuPopover'

// SlashMenu (native) — mounts the anchored-overlay controller and
// registers the 'slash-menu' kind. The WebView's suggestion plugin
// (running with `renderStrategy: 'bridge'`) posts ui.show-popover
// messages when the user types `/`; the controller renders this
// popover as a Modal positioned over the WebView at the right place
// and routes selections back via popover-result.
//
// Metro picks SlashMenu.web.tsx on web; this file is only loaded on
// native. The Platform.OS guard is a belt-and-suspenders check for the
// metro-resolver edge case where the .tsx variant gets loaded on web
// (e.g. through a test config that doesn't honor the platform suffix
// — see vitest's plain resolution).
export function SlashMenu({ webViewRef }: { webViewRef: React.RefObject<unknown> | null }) {
    if (Platform.OS === 'web') return null
    return (
        <AnchoredOverlayController
            webViewRef={webViewRef}
            registry={{ 'slash-menu': SlashMenuPopover }}
        />
    )
}
