import type { ConfigPkg } from './gen-config'
import type { PackageManifest } from './load-manifest'

export function schemaTypeName(slug: string): string {
    const camel = slug.replace(/-([a-z])/g, (_m, c) => c.toUpperCase())
    return `${camel.charAt(0).toUpperCase()}${camel.slice(1)}Schema`
}

export function manifestToConfigPkg(packageName: string, manifest: PackageManifest): ConfigPkg {
    const hasRegister = Boolean(manifest.collections?.register)
    return {
        packageName,
        slug: manifest.slug,
        schemaType: hasRegister ? schemaTypeName(manifest.slug) : '',
        hasRegister,
        hasSidebar: Boolean(manifest.sidebar?.component),
        hasProvider: Boolean(manifest.provider?.component),
        hasSeed: Boolean(manifest.seed?.script),
        settings: (manifest.settings ?? []).map(s => ({
            slug: s.slug,
            label: s.label,
            component: s.component,
        })),
        manifest: {
            name: manifest.name,
            slug: manifest.slug,
            version: manifest.version,
            description: manifest.description,
            ...(manifest.nav ? { nav: manifest.nav } : {}),
            ...(manifest.routes ? { routes: manifest.routes } : {}),
            ...(manifest.publicRoutes ? { publicRoutes: manifest.publicRoutes } : {}),
            ...(manifest.dependencies ? { dependencies: manifest.dependencies } : {}),
        },
    }
}
