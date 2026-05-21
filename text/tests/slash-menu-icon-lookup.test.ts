// Verify every command in SLASH_MENU_COMMANDS advertises an iconName
// that resolves to a Lucide component in the host-side lookup. A
// regression here would render the slash-menu popover with a blank
// icon slot on native: the wire format would carry an iconName the
// host can't resolve, and `resolveSlashMenuIcon` would return null.
//
// We deliberately don't assert on the component identity (the lucide
// stub vitest uses returns Proxy() components, which can't be matched
// against a specific Lucide ref). The contract is "every iconName
// from a real command resolves to something non-null".

import { describe, expect, it } from 'vitest'
import { SLASH_MENU_COMMANDS } from '../tinycld/text/lib/editor/slash-menu-commands'
import {
    resolveSlashMenuIcon,
    SLASH_MENU_ICONS,
} from '../tinycld/text/lib/editor/slash-menu-icon-lookup'

describe('slash-menu icon lookup', () => {
    it('every command in SLASH_MENU_COMMANDS has an iconName', () => {
        for (const cmd of SLASH_MENU_COMMANDS) {
            expect(cmd.iconName).toBeTypeOf('string')
            expect(cmd.iconName.length).toBeGreaterThan(0)
        }
    })

    it('every command iconName resolves to a non-null component', () => {
        for (const cmd of SLASH_MENU_COMMANDS) {
            const icon = resolveSlashMenuIcon(cmd.iconName)
            expect(icon, `iconName=${cmd.iconName} for command=${cmd.id}`).not.toBeNull()
        }
    })

    it('the lookup map has an entry for every command iconName', () => {
        const requiredIconNames = new Set(SLASH_MENU_COMMANDS.map(c => c.iconName))
        for (const iconName of requiredIconNames) {
            expect(SLASH_MENU_ICONS[iconName], `missing icon: ${iconName}`).toBeDefined()
        }
    })

    it('returns null for an unknown iconName instead of throwing', () => {
        expect(resolveSlashMenuIcon('NotARealIcon')).toBeNull()
        expect(resolveSlashMenuIcon('')).toBeNull()
    })

    it('SlashMenuIconName is keyof typeof SLASH_MENU_ICONS (compile-time check)', () => {
        // Type-level proof: a literal known to be in the map is
        // assignable; a typo isn't. The `@ts-expect-error` line MUST
        // remain a compile error — if it stops being one, the union
        // has regressed back to `string` and typos slip through.
        const valid: keyof typeof SLASH_MENU_ICONS = 'Heading1'
        // @ts-expect-error — 'BogusIcon' is not in SLASH_MENU_ICONS
        const bogus: keyof typeof SLASH_MENU_ICONS = 'BogusIcon'
        expect(valid).toBe('Heading1')
        // Cast for runtime check — the test exists to lock the type
        // constraint above; resolveSlashMenuIcon accepts strings at
        // runtime so an unregistered name returns null rather than
        // crashing.
        expect(resolveSlashMenuIcon(bogus as string)).toBeNull()
    })
})
