// Side-effect-only module: configures @tinycld/core BEFORE any other core
// import resolves. _layout.tsx imports this FIRST so config-reading modules
// inside core (server-address.ts → config.ts's PB_SERVER_ADDR proxy) see the
// registered config on their first read.
import { configureCore } from '@tinycld/core'
import { resolveEnvAddress, setResolvedAddress } from '@tinycld/core/lib/server-address'
import { appConfig } from './app-config'

configureCore(appConfig)

// Resolve the server address eagerly too (web = same-origin via appConfig's
// webShortcut). The real boot gate in _layout.tsx also resolves it; doing it
// here as well keeps PB_SERVER_ADDR readable even for code paths that import
// core before the gate's effect runs.
const addr = resolveEnvAddress()
if (addr) setResolvedAddress(addr)
