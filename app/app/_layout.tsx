// configure-core MUST be first: it calls configureCore() + resolves the server
// address at module-init, before Providers (→ pocketbase.ts → PB_SERVER_ADDR)
// is imported. ES modules execute in source order during the import phase.
import '../lib/configure-core'
import '../global.css'
import { Providers } from '@tinycld/core'
import { Stack } from 'expo-router'

export default function Layout() {
    return (
        <Providers>
            <Stack />
        </Providers>
    )
}
