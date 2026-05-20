import * as path from 'node:path'

// All generator paths derive from the app member dir (the dir containing this
// scripts/ folder's parent). TINYCLD_APP_DIR overrides for tests.
export const APP_DIR = process.env.TINYCLD_APP_DIR
    ? path.resolve(process.env.TINYCLD_APP_DIR)
    : path.resolve(import.meta.dirname, '..')

export const WS_ROOT = path.resolve(APP_DIR, '..')
export const GENERATED_DIR = path.join(APP_DIR, 'lib', 'generated')
export const ROUTES_BASE = path.join(APP_DIR, 'app', 'a', '[orgSlug]')
export const SERVER_DIR = path.join(APP_DIR, 'server')
export const MIGRATIONS_DIR = path.join(SERVER_DIR, 'pb_migrations')
export const HOOKS_DIR = path.join(SERVER_DIR, 'pb_hooks')

// Resolve a workspace member's on-disk directory by package name via the
// workspace-root node_modules symlink (where members are linked in this layout).
export function memberDir(packageName: string): string {
    return path.join(WS_ROOT, 'node_modules', packageName)
}
