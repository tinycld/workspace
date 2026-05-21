// Reuse core's wire-protocol implementation. The client is platform-
// agnostic JS (no DOM dependencies beyond the standard WebSocket API,
// which the WebView provides) and bundles cleanly here. We pass
// through the same wire protocol the web side uses, so the broker
// treats this WebView client identically to a web tab.
import {
    LOCAL_ORIGIN,
    REMOTE_ORIGIN,
    RealtimeClient,
    SYNC_ORIGIN,
} from '@tinycld/core/lib/realtime/client'

export { LOCAL_ORIGIN, REMOTE_ORIGIN, RealtimeClient, SYNC_ORIGIN }
