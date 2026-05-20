import fs from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'vitest/config'

// Workspace-root vitest config. Supplies dedup pins, stub aliases, and the
// react-native/expo/sentry mocks that let the broader core suite run under
// Node without the Metro/RN runtime.
const ROOT = import.meta.dirname
const CORE_DIR = path.join(ROOT, 'core')
const APP_GENERATED = path.join(ROOT, 'app', 'lib', 'generated')

// Locate a hoisted dependency's dir. In this workspace layout deps hoist to
// the workspace-root node_modules (all members declare framework deps as
// peerDependencies only, so the app shell's direct deps live in
// node_modules/ here at the root). Falls back one level up (CI layouts where
// the workspace root is nested under another root).
const pkgDir = (pkg: string): string => {
    for (const root of [path.join(ROOT, 'node_modules'), path.join(ROOT, '..', 'node_modules')]) {
        const candidate = path.join(root, pkg)
        if (fs.existsSync(candidate)) return candidate
    }
    return path.join(ROOT, 'node_modules', pkg)
}

export default defineConfig({
    resolve: {
        alias: [
            // --- dedup pins (Vite SSR resolver differs from Metro; keep until
            //     a test proves the workspace dedupes these on its own) ---
            { find: /^react$/, replacement: path.join(pkgDir('react'), 'index.js') },
            {
                find: /^react\/jsx-runtime$/,
                replacement: path.join(pkgDir('react'), 'jsx-runtime.js'),
            },
            {
                find: /^react\/jsx-dev-runtime$/,
                replacement: path.join(pkgDir('react'), 'jsx-dev-runtime.js'),
            },
            // yjs/y-protocols use instanceof checks; a duplicate copy reached
            // through a member symlink breaks nested Y.Map.set. Pin to the
            // single install.
            { find: /^yjs$/, replacement: pkgDir('yjs') },
            { find: /^y-protocols\/(.+)$/, replacement: `${pkgDir('y-protocols')}/$1` },
            // hyperformula's ESM build has broken relative imports under Vite
            // SSR; pin to the self-consistent commonjs entry.
            {
                find: /^hyperformula$/,
                replacement: path.join(pkgDir('hyperformula'), 'commonjs/index.js'),
            },
            // --- @tinycld/core path remaps. Unlike Metro, Vite's exports-map
            //     resolution does NOT do directory-index fallback, so
            //     `@tinycld/core/lib/notify` (a dir → lib/notify/index.ts) fails
            //     to load through the exports wildcard. Remap straight to the
            //     core source path, which Vite resolves with its own extension
            //     + index probing.
            {
                find: /^@tinycld\/core$/,
                replacement: path.join(CORE_DIR, 'index.ts'),
            },
            {
                find: /^@tinycld\/core\/(.+)$/,
                replacement: `${CORE_DIR}/$1`,
            },
            // --- @tinycld/app-generated/* build-time contract (written to
            //     app/lib/generated/ by the generator; Vitest doesn't read
            //     tsconfig paths) ---
            {
                find: /^@tinycld\/app-generated\/(.+)$/,
                replacement: `${APP_GENERATED}/$1`,
            },
            // --- test doubles ---
            // expo-clipboard transitively pulls in expo-modules-core, whose
            // module-load-time side effects don't survive a bare Node test env.
            {
                find: /^expo-clipboard$/,
                replacement: path.join(ROOT, 'tests/expo-clipboard-stub.ts'),
            },
            // expo-router's CJS entry does `require("./global")` at module top,
            // which Node can't resolve when reached through a member symlink.
            {
                find: /^expo-router$/,
                replacement: path.join(ROOT, 'tests/expo-router-stub.ts'),
            },
            // lucide-react-native pulls in react-native-svg (TS source, not
            // transformed in node_modules under Vitest); a CJS Proxy stub
            // yields a harmless component for any named icon import.
            {
                find: /^lucide-react-native$/,
                replacement: path.join(ROOT, 'tests/lucide-react-native-stub.cjs'),
            },
        ],
    },
    test: {
        environment: 'node',
        include: [
            'tests/**/*.test.{ts,tsx}',
            'core/**/__tests__/**/*.test.{ts,tsx}',
            'core/**/*.test.{ts,tsx}',
            'app/scripts/**/__tests__/**/*.test.{ts,tsx}',
            'package-scripts/tests/**/*.test.{ts,tsx}',
        ],
        setupFiles: ['tests/unit-setup.ts'],
    },
})
