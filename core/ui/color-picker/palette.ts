// Color palettes shared by the in-app color pickers (calc cell fill,
// calc text color, calc borders, text-editor color marks, label
// settings dialog). Hex values come from Google Sheets' default
// palette — the 80-color grid is the wide one used by most pickers;
// BORDERS_PALETTE is a compact 10-color subset used where a single
// row fits the surrounding UI better (calc's borders submenu).
//
// `hex` (rather than `value`) because Reanimated's Babel plugin warns
// whenever it sees `.value` accessed inside an inline `style={…}`
// prop — it can't distinguish a shared value from a plain field, so
// any `swatch.hex` in a style threw the "shared value's .value
// inside reanimated inline style" dev warning. Renaming the field
// sidesteps the syntactic heuristic.
export interface Swatch {
    hex: string
    label: string
}

export const BORDERS_PALETTE: readonly Swatch[] = [
    { hex: '', label: 'Default' },
    { hex: '#000000', label: 'Black' },
    { hex: '#666666', label: 'Dark gray' },
    { hex: '#B00020', label: 'Red' },
    { hex: '#E64A19', label: 'Orange' },
    { hex: '#F9A825', label: 'Yellow' },
    { hex: '#2E7D32', label: 'Green' },
    { hex: '#1565C0', label: 'Blue' },
    { hex: '#6A1B9A', label: 'Purple' },
    { hex: '#AD1457', label: 'Pink' },
]

// 10-wide grid laid out like Google Sheets:
//   row 0: grayscale (black → white)
//   row 1: saturated hues
//   rows 2-7: 6 lightness ramps per hue (light → dark)
// The empty-string sentinel is handled by consumers — the picker
// component renders an explicit "Clear" affordance above the grid
// rather than embedding `{ hex: '', … }` here.
export const COLOR_PALETTE: readonly Swatch[] = [
    { hex: '#000000', label: 'Black' },
    { hex: '#434343', label: 'Dark gray 4' },
    { hex: '#666666', label: 'Dark gray 3' },
    { hex: '#999999', label: 'Dark gray 2' },
    { hex: '#B7B7B7', label: 'Dark gray 1' },
    { hex: '#CCCCCC', label: 'Gray' },
    { hex: '#D9D9D9', label: 'Light gray 1' },
    { hex: '#EFEFEF', label: 'Light gray 2' },
    { hex: '#F3F3F3', label: 'Light gray 3' },
    { hex: '#FFFFFF', label: 'White' },

    { hex: '#980000', label: 'Red berry' },
    { hex: '#FF0000', label: 'Red' },
    { hex: '#FF9900', label: 'Orange' },
    { hex: '#FFFF00', label: 'Yellow' },
    { hex: '#00FF00', label: 'Green' },
    { hex: '#00FFFF', label: 'Cyan' },
    { hex: '#4A86E8', label: 'Cornflower blue' },
    { hex: '#0000FF', label: 'Blue' },
    { hex: '#9900FF', label: 'Purple' },
    { hex: '#FF00FF', label: 'Magenta' },

    { hex: '#E6B8AF', label: 'Light red berry 3' },
    { hex: '#F4CCCC', label: 'Light red 3' },
    { hex: '#FCE5CD', label: 'Light orange 3' },
    { hex: '#FFF2CC', label: 'Light yellow 3' },
    { hex: '#D9EAD3', label: 'Light green 3' },
    { hex: '#D0E0E3', label: 'Light cyan 3' },
    { hex: '#C9DAF8', label: 'Light cornflower blue 3' },
    { hex: '#CFE2F3', label: 'Light blue 3' },
    { hex: '#D9D2E9', label: 'Light purple 3' },
    { hex: '#EAD1DC', label: 'Light magenta 3' },

    { hex: '#DD7E6B', label: 'Light red berry 2' },
    { hex: '#EA9999', label: 'Light red 2' },
    { hex: '#F9CB9C', label: 'Light orange 2' },
    { hex: '#FFE599', label: 'Light yellow 2' },
    { hex: '#B6D7A8', label: 'Light green 2' },
    { hex: '#A2C4C9', label: 'Light cyan 2' },
    { hex: '#A4C2F4', label: 'Light cornflower blue 2' },
    { hex: '#9FC5E8', label: 'Light blue 2' },
    { hex: '#B4A7D6', label: 'Light purple 2' },
    { hex: '#D5A6BD', label: 'Light magenta 2' },

    { hex: '#CC4125', label: 'Light red berry 1' },
    { hex: '#E06666', label: 'Light red 1' },
    { hex: '#F6B26B', label: 'Light orange 1' },
    { hex: '#FFD966', label: 'Light yellow 1' },
    { hex: '#93C47D', label: 'Light green 1' },
    { hex: '#76A5AF', label: 'Light cyan 1' },
    { hex: '#6D9EEB', label: 'Light cornflower blue 1' },
    { hex: '#6FA8DC', label: 'Light blue 1' },
    { hex: '#8E7CC3', label: 'Light purple 1' },
    { hex: '#C27BA0', label: 'Light magenta 1' },

    { hex: '#A61C00', label: 'Dark red berry 1' },
    { hex: '#CC0000', label: 'Dark red 1' },
    { hex: '#E69138', label: 'Dark orange 1' },
    { hex: '#F1C232', label: 'Dark yellow 1' },
    { hex: '#6AA84F', label: 'Dark green 1' },
    { hex: '#45818E', label: 'Dark cyan 1' },
    { hex: '#3C78D8', label: 'Dark cornflower blue 1' },
    { hex: '#3D85C6', label: 'Dark blue 1' },
    { hex: '#674EA7', label: 'Dark purple 1' },
    { hex: '#A64D79', label: 'Dark magenta 1' },

    { hex: '#85200C', label: 'Dark red berry 2' },
    { hex: '#990000', label: 'Dark red 2' },
    { hex: '#B45F06', label: 'Dark orange 2' },
    { hex: '#BF9000', label: 'Dark yellow 2' },
    { hex: '#38761D', label: 'Dark green 2' },
    { hex: '#134F5C', label: 'Dark cyan 2' },
    { hex: '#1155CC', label: 'Dark cornflower blue 2' },
    { hex: '#0B5394', label: 'Dark blue 2' },
    { hex: '#351C75', label: 'Dark purple 2' },
    { hex: '#741B47', label: 'Dark magenta 2' },

    { hex: '#5B0F00', label: 'Dark red berry 3' },
    { hex: '#660000', label: 'Dark red 3' },
    { hex: '#783F04', label: 'Dark orange 3' },
    { hex: '#7F6000', label: 'Dark yellow 3' },
    { hex: '#274E13', label: 'Dark green 3' },
    { hex: '#0C343D', label: 'Dark cyan 3' },
    { hex: '#1C4587', label: 'Dark cornflower blue 3' },
    { hex: '#073763', label: 'Dark blue 3' },
    { hex: '#20124D', label: 'Dark purple 3' },
    { hex: '#4C1130', label: 'Dark magenta 3' },
]
