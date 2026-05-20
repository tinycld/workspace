// Side-effect-only module: configures @tinycld/core BEFORE any other core
// import resolves. _layout.tsx imports this FIRST so config-reading modules
// inside core (server-address.ts → config.ts's PB_SERVER_ADDR proxy) see the
// registered config + a resolved address on their first read.
//
// Minimal spike config: web resolves the PB address from the page origin (the
// dev proxy / app server routes /api to PocketBase same-origin). A fuller app
// shell (connect flow, native env shortcuts, Sentry) is a follow-up.
import { configureCore } from '@tinycld/core/lib/core-config'
import { resolveEnvAddress, setResolvedAddress } from '@tinycld/core/lib/server-address'

configureCore({
    brandName: 'TinyCld',
    serverShortcuts: {},
    webShortcut: () => (typeof window !== 'undefined' ? window.location.origin : null),
})

// Resolve the server address now (web = same-origin) so PB_SERVER_ADDR is
// readable by the time Providers mounts pocketbase.ts.
const addr = resolveEnvAddress()
if (addr) setResolvedAddress(addr)
