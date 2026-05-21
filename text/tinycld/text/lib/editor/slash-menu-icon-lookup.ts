import {
    Code2,
    Heading1,
    Heading2,
    Heading3,
    Image as ImageIcon,
    List,
    ListOrdered,
    type LucideIcon,
    Minus,
    Quote,
    Table as TableIcon,
} from 'lucide-react-native'

// Lucide identifier → component map for the slash menu's serialized
// wire format. The bridge render strategy can't post a LucideIcon
// reference across the WebView's JSON message bus, so each command
// carries a string `iconName` (e.g. 'Heading1', 'Image') the host
// resolves back to the actual icon component here.
//
// Typed as `as const` + `Record<SlashMenuIconName, LucideIcon>` so
// SlashMenuIconName below is the union of literal keys. The cross-
// check between SLASH_MENU_COMMANDS.iconName and this map is therefore
// a compile-time constraint — a typo in slash-menu-commands.ts will
// fail typecheck rather than silently render no icon.
export const SLASH_MENU_ICONS = {
    Heading1,
    Heading2,
    Heading3,
    List,
    ListOrdered,
    Quote,
    Code2,
    Table: TableIcon,
    Image: ImageIcon,
    Minus,
} as const satisfies Record<string, LucideIcon>

// The set of identifiers SLASH_MENU_ICONS knows about. Exported so
// SlashMenuCommand.iconName can be typed against it; new commands
// must add their icon here first or fail typecheck.
export type SlashMenuIconName = keyof typeof SLASH_MENU_ICONS

// Look up an icon by the wire identifier. Returns the component if
// known, or null if the host shipped a command whose iconName isn't
// in the lookup (e.g. a third-party slash entry from a future
// extension point). The popover renders nothing in the icon slot for
// unknown entries — the label still appears.
//
// Accepts `string` (not SlashMenuIconName) because the wire format
// passes raw strings off the message bus where we can't guarantee
// the sender's iconName has been registered.
export function resolveSlashMenuIcon(iconName: string): LucideIcon | null {
    return (SLASH_MENU_ICONS as Record<string, LucideIcon>)[iconName] ?? null
}
