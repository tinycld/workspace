// Test-only stub for `lucide-react-native`. The real bundle pulls
// in `react-native-svg`, whose source uses TypeScript syntax that
// Vitest's transformer doesn't apply to node_modules. We don't
// render icons in unit tests anyway — assertions about icon
// rendering belong in Playwright.
//
// Implemented as CJS (.cjs) so we can use a Proxy on module.exports.
// Any named-icon import (ExternalLink, AlertTriangle, …) yields the
// same harmless component stub. Tests that genuinely need a real
// icon should reach for vi.mock locally; this stub only exists so
// the module graph can finish loading from sibling source under
// packages/@tinycld/<sibling>/... where the real bundle would crash.
//
// Vitest's ES↔CJS interop reads named exports from Object.keys() on
// the CJS module.exports, so the Proxy's `get` trap alone isn't
// enough — ESM `import { Heading1 } from '...'` requires Heading1 to
// appear as an own property. We pre-populate the dictionary with
// every Lucide identifier referenced from the codebase so static
// imports resolve to the Stub function; the Proxy handles any
// additional dynamic lookups (a defensive fallback).

const Stub = () => null

// Lucide icon names referenced by import statements anywhere in the
// codebase. Add new names here when a new icon is imported. The list
// is overinclusive on purpose: a missing entry would surface as an
// `undefined` named import in tests that try to render the icon,
// which is harder to diagnose than an unused name.
const NAMES = [
    'AlertCircle', 'AlertTriangle', 'AlignCenter', 'AlignJustify', 'AlignLeft', 'AlignRight',
    'Archive', 'ArrowDown', 'ArrowDownToLine', 'ArrowLeft', 'ArrowRight', 'ArrowUp',
    'AtSign', 'Bell', 'BellOff', 'Bold', 'Book', 'BookOpen', 'Bot', 'Box', 'Calendar',
    'Camera', 'Check', 'CheckCircle', 'CheckSquare', 'ChevronDown', 'ChevronLeft',
    'ChevronRight', 'ChevronUp', 'Circle', 'Clipboard', 'Clock', 'Cloud', 'CloudOff',
    'Code', 'Code2', 'Columns', 'Copy', 'CornerDownLeft', 'Cpu', 'CreditCard', 'Crop',
    'Database', 'Download', 'Edit', 'Edit2', 'Edit3', 'ExternalLink', 'Eye', 'EyeOff',
    'File', 'FileText', 'Files', 'Filter', 'Flag', 'Folder', 'FolderOpen', 'Forward',
    'Globe', 'GraduationCap', 'Grid', 'HardDrive', 'Hash', 'Headphones', 'Heading1',
    'Heading2', 'Heading3', 'Heading4', 'Heading5', 'Heading6', 'HelpCircle', 'Highlighter',
    'Home', 'Image', 'Inbox', 'Info', 'Italic', 'Key', 'Keyboard', 'Languages', 'Layout',
    'Link', 'Link2', 'List', 'ListChecks', 'ListOrdered', 'Loader', 'Lock', 'LogIn',
    'LogOut', 'Mail', 'MailOpen', 'Map', 'Maximize', 'Maximize2', 'MenuIcon', 'Menu',
    'MessageCircle', 'MessageSquare', 'Mic', 'MicOff', 'Minimize', 'Minimize2', 'Minus',
    'MonitorSmartphone', 'MoreHorizontal', 'MoreVertical', 'Move', 'Music', 'Package',
    'Palette', 'Paperclip', 'Pause', 'Pencil', 'Phone', 'PieChart', 'Pin', 'PinOff',
    'Play', 'Plus', 'PlusCircle', 'Pointer', 'Power', 'Printer', 'Quote', 'RefreshCcw',
    'RefreshCw', 'Replace', 'ReplaceAll', 'Reply', 'ReplyAll', 'RotateCcw', 'Save', 'Search', 'Send', 'Server',
    'Settings', 'Settings2', 'Share', 'Share2', 'Shield', 'ShieldCheck', 'Shuffle',
    'Sidebar', 'Slack', 'SlidersHorizontal', 'Smartphone', 'Smile', 'Sparkles',
    'Speaker', 'Square', 'Star', 'Strikethrough', 'Subscript', 'Sun', 'Superscript',
    'Table', 'Tag', 'Terminal', 'TestTube', 'Trash', 'Trash2', 'TrendingDown',
    'TrendingUp', 'Triangle', 'Type', 'Underline', 'Undo', 'Unlock', 'Upload',
    'User', 'UserCheck', 'UserPlus', 'Users', 'Video', 'VideoOff', 'Volume', 'Volume2',
    'VolumeX', 'Wifi', 'WifiOff', 'WrapText', 'X', 'XCircle', 'XSquare', 'Zap',
    'ZoomIn', 'ZoomOut',
]

const exports = { default: Stub }
for (const name of NAMES) {
    exports[name] = Stub
}
exports.__esModule = true

module.exports = new Proxy(exports, {
    get(target, prop) {
        if (typeof prop === 'symbol') return Reflect.get(target, prop)
        if (prop in target) return target[prop]
        // Unknown icon name: return the Stub anyway so dynamic
        // lookups don't crash. Static `import { Foo }` will already
        // have been resolved against `target` above.
        return Stub
    },
})
