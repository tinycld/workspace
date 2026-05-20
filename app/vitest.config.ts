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
    },
})
