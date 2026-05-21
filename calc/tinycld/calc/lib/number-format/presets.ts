// NumberFormatPreset is one row in the format-picker menu (the "123"
// dropdown — see Toolbar). Every preset is just a label + a numFmt
// pattern; the formatter (./format.ts) consumes the pattern. This is
// the single source of truth that drives the menu UI, the
// $/%/.0/.00 toolbar shortcuts, and any preset-name lookup elsewhere.
//
// Adding a new preset is a one-line registry entry. Presets aren't
// referenced anywhere else by id, so removing one is also safe.
//
// Special ids:
//   - `automatic` carries numFmt=null. The formatter falls back to
//     kind-aware defaults (the pre-numFmt behavior) when it sees a
//     null pattern. This is "no format applied" — the cell renders
//     however its raw value naturally renders.
//   - `plain` uses '@' which numfmt treats as text passthrough; the
//     evaluator additionally short-circuits to skip number-format
//     evaluation entirely for `@` so user-typed numeric strings
//     stay verbatim.
export interface NumberFormatPreset {
    id: string
    label: string
    sample: string
    numFmt: string | null
    group: PresetGroup
}

export type PresetGroup = 'basic' | 'numeric' | 'monetary' | 'date'

// The order here is the order the menu renders, top-to-bottom. Groups
// are visually separated in the menu via the `group` field.
export const NUMBER_FORMAT_PRESETS: NumberFormatPreset[] = [
    { id: 'automatic', label: 'Automatic', sample: '', numFmt: null, group: 'basic' },
    { id: 'plain', label: 'Plain text', sample: '', numFmt: '@', group: 'basic' },

    { id: 'number', label: 'Number', sample: '1,000.12', numFmt: '#,##0.00', group: 'numeric' },
    { id: 'percent', label: 'Percent', sample: '10.12%', numFmt: '0.00%', group: 'numeric' },
    {
        id: 'scientific',
        label: 'Scientific',
        sample: '1.01E+03',
        numFmt: '0.00E+00',
        group: 'numeric',
    },

    {
        id: 'accounting',
        label: 'Accounting',
        sample: '$ (1,000.12)',
        numFmt: '_($* #,##0.00_);_($* (#,##0.00);_($* "-"??_);_(@_)',
        group: 'monetary',
    },
    {
        id: 'financial',
        label: 'Financial',
        sample: '(1,000.12)',
        numFmt: '#,##0.00;(#,##0.00)',
        group: 'monetary',
    },
    {
        id: 'currency',
        label: 'Currency',
        sample: '$1,000.12',
        numFmt: '$#,##0.00',
        group: 'monetary',
    },
    {
        id: 'currency-rounded',
        label: 'Currency rounded',
        sample: '$1,000',
        numFmt: '$#,##0',
        group: 'monetary',
    },

    { id: 'date', label: 'Date', sample: '9/26/2008', numFmt: 'm/d/yyyy', group: 'date' },
    { id: 'time', label: 'Time', sample: '3:59:00 PM', numFmt: 'h:mm:ss AM/PM', group: 'date' },
    {
        id: 'datetime',
        label: 'Date time',
        sample: '9/26/2008 15:59:00',
        numFmt: 'm/d/yyyy h:mm:ss',
        group: 'date',
    },
    { id: 'duration', label: 'Duration', sample: '24:01:00', numFmt: '[h]:mm:ss', group: 'date' },
]

// findPresetByNumFmt returns the registered preset whose numFmt matches
// the given pattern, or undefined when no preset matches. Used by the
// menu to show a checkmark next to the active preset, and to detect
// when the user has a custom (non-preset) format applied.
export function findPresetByNumFmt(numFmt: string | undefined): NumberFormatPreset | undefined {
    if (numFmt == null) {
        // Convention: undefined === automatic. The 'automatic' preset
        // carries numFmt: null, but the cell-side stores absence as
        // undefined; treat them the same.
        return NUMBER_FORMAT_PRESETS.find(p => p.id === 'automatic')
    }
    return NUMBER_FORMAT_PRESETS.find(p => p.numFmt === numFmt)
}

// findPresetById is a direct lookup by registry id. Returns undefined
// for unknown ids so callers can fall back gracefully (e.g. a stale
// preset id from an older client).
export function findPresetById(id: string): NumberFormatPreset | undefined {
    return NUMBER_FORMAT_PRESETS.find(p => p.id === id)
}
