import { packageRegistry } from '@tinycld/core/lib/packages/static-registry'
import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { type Shortcut, useRegisterShortcuts } from '@tinycld/core/lib/shortcuts'
import { useShortcutHelp, useShortcutHelpStore } from '@tinycld/core/lib/shortcuts/help'
import { useRouter } from 'expo-router'
import { useMemo } from 'react'

/**
 * Registers the app-level shortcuts that are always active: the help overlay
 * and the `t <letter>` jumps assembled from each installed package's
 * `manifest.nav.shortcut`.
 */
export function CoreShortcuts() {
    const helpStore = useShortcutHelp()
    const router = useRouter()
    const orgHref = useOrgHref()

    const shortcuts = useMemo<Shortcut[]>(() => {
        const list: Shortcut[] = [
            {
                id: 'core.help',
                // Shift must appear in the binding because tinykeys ignores
                // shortcuts whose active modifier set doesn't match the
                // declared one — pressing `?` (i.e. Shift+/) with a bare `?`
                // binding would never fire.
                keys: 'Shift+?',
                scope: 'global',
                group: 'Help',
                description: 'Show keyboard shortcuts',
                run: () => helpStore.toggle(),
            },
            {
                id: 'core.closeHelp',
                keys: 'Escape',
                scope: 'modal',
                group: 'Help',
                description: 'Close dialog',
                allowInInputs: true,
                when: () => useShortcutHelpStore.getState().isOpen,
                run: () => helpStore.close(),
            },
        ]

        for (const pkg of packageRegistry) {
            const letter = pkg.nav?.shortcut
            if (!letter) continue
            list.push({
                id: `core.jumpTo.${pkg.slug}`,
                keys: `t ${letter}`,
                scope: 'global',
                group: 'Navigation',
                description: `Go to ${pkg.name}`,
                run: () => router.push(orgHref(pkg.slug)),
            })
        }
        return list
    }, [helpStore, router, orgHref])

    useRegisterShortcuts(shortcuts)

    return null
}
