import path from 'node:path'
import { defineConfig } from 'vitest/config'

// The app shell owns the canonical vitest config. Package-scoped runs point the
// `include` glob (or a positional filter) at one package's tests/, but always
// resolve through these aliases so cross-package `@tinycld/core/*` imports and
// the `~/*` package-source alias work identically everywhere.
const APP_DIR = __dirname
const CORE_DIR = path.resolve(APP_DIR, '..', 'core')

export default defineConfig({
    resolve: {
        alias: [
            // @tinycld/core/* — Vite's exports resolution lacks Metro's
            // directory-index fallback, so remap straight to the core dir.
            { find: /^@tinycld\/core$/, replacement: path.join(CORE_DIR, 'index.ts') },
            { find: /^@tinycld\/core\/(.+)$/, replacement: `${CORE_DIR}/$1` },
            // @tinycld/app-generated/* — build-time contract written to app/lib/generated.
            {
                find: /^@tinycld\/app-generated\/(.+)$/,
                replacement: path.join(APP_DIR, 'lib', 'generated', '$1'),
            },
            // react-native's entry uses Flow syntax (`import typeof`) and CJS
            // internals that Vite/Rollup cannot parse. Redirect to a CJS stub
            // that exposes the minimal surface unit tests touch transitively.
            {
                find: /^react-native$/,
                replacement: path.join(APP_DIR, 'tests', 'react-native-stub.cjs'),
            },
            // @react-native-async-storage/async-storage requires the RN native
            // bridge; redirect to an in-memory stub so unit tests run without it.
            {
                find: /^@react-native-async-storage\/async-storage$/,
                replacement: path.join(APP_DIR, 'tests', 'async-storage-stub.cjs'),
            },
            // @sentry/react-native transitively requires react-native/Libraries/Promise
            // via CJS require (bypasses Vite aliases). Stub out the whole package.
            {
                find: /^@sentry\/react-native$/,
                replacement: path.join(APP_DIR, 'tests', 'sentry-stub.cjs'),
            },
            // expo-router's CJS entry follows source maps to src/exports.ts which
            // contains JSX that Vite's node environment cannot parse. Use a minimal
            // stub that exposes the API surface used by package unit tests.
            {
                find: /^expo-router$/,
                replacement: path.join(APP_DIR, 'tests', 'expo-router-stub.ts'),
            },
            // ~/* — package source. Resolved relative to the package's own dir
            // at invocation time via the test root, so we map it dynamically below.
        ],
    },
    test: {
        environment: 'node',
        include: ['tests/**/*.test.{ts,tsx}'],
        // The app shell has no tests/ of its own yet; self-mode `npm test`
        // (tinycld-pkg test from app/) must not fail on an empty match.
        passWithNoTests: true,
        setupFiles: [path.join(APP_DIR, 'tests', 'unit-setup.ts')],
    },
})
