export interface PackageManifest {
    name: string
    slug: string
    version: string
    description: string

    routes?: {
        directory: string
    }

    publicRoutes?: {
        directory: string
    }

    nav?: {
        label: string
        icon: string
        order?: number
        /**
         * Single character that registers a `t <letter>` jump to this
         * package's root screen. Must be unique across installed packages
         * (validated at generation time).
         */
        shortcut?: string
    }

    migrations?: {
        directory: string
    }

    hooks?: {
        directory: string
    }

    collections?: {
        register: string
        types: string
    }

    sidebar?: {
        component: string
    }

    settings?: {
        slug: string
        component: string
        label: string
    }[]

    seed?: {
        script: string
    }

    tests?: {
        directory: string
    }

    server?: {
        package: string
        module: string
    }

    help?: {
        directory: string
    }

    /**
     * Subpath (relative to the package root, resolved through the package's
     * exports map) to a TS module exporting a default async function. The
     * generator runs every declared build script before emitting generated
     * files; `dev` keeps the process alive in --watch mode for incremental
     * rebuilds. Use for build artifacts the package's runtime code needs
     * but that the bundler can't produce on its own (e.g. an embedded
     * webview bundle).
     */
    build?: {
        script: string
    }

    /**
     * Optional component (rendered from `provider`) that wraps app children
     * with package-supplied context. Resolved through the exports map like
     * other component fields.
     */
    provider?: {
        component: string
    }

    dependencies?: string[]
}
