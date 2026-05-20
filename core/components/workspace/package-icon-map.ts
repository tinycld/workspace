import {
    Building2,
    Calendar,
    CircleHelp,
    FileSpreadsheet,
    FileText,
    HardDrive,
    Home,
    type LucideIcon,
    Mail,
    PenLine,
    Settings,
    Table,
    User,
    Users,
} from 'lucide-react-native'

// Lucide ships ~1500 icons; treeshaking can't follow a namespace import, so
// we hand-curate the icons used by package manifests rather than importing
// the whole library. When a new package wants an icon not on this list,
// add a named import above and one line below — packages fall back to the
// "?" CircleHelp glyph until that's done. Names match the kebab-case
// `manifest.nav.icon` field.
const iconMap: Record<string, LucideIcon> = {
    users: Users,
    home: Home,
    mail: Mail,
    calendar: Calendar,
    settings: Settings,
    user: User,
    building: Building2,
    'hard-drive': HardDrive,
    'pen-line': PenLine,
    table: Table,
    'file-spreadsheet': FileSpreadsheet,
    'file-text': FileText,
}

export function getIcon(name: string): LucideIcon {
    return iconMap[name] ?? CircleHelp
}
