/**
 * Ambient declaration for app-sibling-provided generated modules.
 *
 * The runnable app shell generates these files at build time via
 * `app/scripts/generate.ts` and exposes them through a `@tinycld/app-generated/*`
 * path alias in its own tsconfig. Core consumes them by name; the actual
 * contents are only visible to the app shell.
 *
 * The minimal shape here lets core typecheck standalone (without needing the
 * app's generated files on disk). Concrete types come from the path mapping
 * when core is consumed alongside the app.
 *
 * NOTE: the old generated package-{registry,collections,providers,sidebars,
 * settings,seeds} modules were removed — their values are now runtime
 * singletons in core/lib/packages/{static-registry,derive-components} and the
 * config array in @tinycld/app-generated/tinycld-config. Only package-help
 * remains a generated module that core imports by name.
 */
declare module '@tinycld/app-generated/package-help' {
    export interface HelpTopicEntry {
        id: string
        pkgSlug: string
        topicId: string
        title: string
        summary: string
        tags: string[]
        body: string
    }
    export interface HelpGroup {
        packageName: string
        pkgSlug: string
        topics: HelpTopicEntry[]
    }
    export const packageHelp: HelpGroup[]
}
