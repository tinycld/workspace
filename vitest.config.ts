import path from 'node:path'
import { defineConfig } from 'vitest/config'

// Workspace-root vitest config used while running tests across members from the
// repo root during the framework build. It supplies the alias that lets core's
// runtime modules resolve `@tinycld/app-generated/*` (the generator writes those
// into app/lib/generated/). Per-package scoped configs (app/, contacts/) add
// their own `~/*` source alias on top of this. (Task 5.2 formalizes the
// per-package two-tier configs; this root config keeps `vitest run` green from
// the workspace root in the meantime.)
const ROOT = import.meta.dirname
const CORE_DIR = path.join(ROOT, 'core')
const APP_GENERATED = path.join(ROOT, 'app', 'lib', 'generated')

export default defineConfig({
    resolve: {
        alias: [
            { find: /^@tinycld\/core$/, replacement: path.join(CORE_DIR, 'index.ts') },
            { find: /^@tinycld\/core\/(.+)$/, replacement: `${CORE_DIR}/$1` },
            { find: /^@tinycld\/app-generated\/(.+)$/, replacement: `${APP_GENERATED}/$1` },
        ],
    },
    test: {
        environment: 'node',
        // Scoped to the modules built so far in this framework effort. The
        // broader pre-existing core test suite (core/lib/__tests__,
        // core/lib/notify/…) needs the full react-native/expo stub setup that
        // Task 5.2 ports into the app vitest config; until then those are out of
        // scope and not included here.
        include: [
            'tests/**/*.test.{ts,tsx}',
            'core/lib/packages/__tests__/**/*.test.{ts,tsx}',
            'app/scripts/**/__tests__/**/*.test.{ts,tsx}',
        ],
    },
})
