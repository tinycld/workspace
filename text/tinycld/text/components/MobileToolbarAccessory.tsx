import type { EditorCommands, EditorToolbarState } from '@tinycld/core/lib/editor/types'

interface MobileToolbarAccessoryProps {
    commands: EditorCommands
    toolbarState: EditorToolbarState
    editable: boolean
}

// Web + Android fallback for MobileToolbarAccessory. The iOS-only
// .ios.tsx variant uses Keyboard listener + absolute positioning to
// float a format bar above the soft keyboard. On web there's no soft
// keyboard to float over; on Android the keyboard-floating UX
// belongs to a different platform extension we haven't built yet.
// Metro picks the .ios.tsx variant on iOS via platform extensions.
export function MobileToolbarAccessory(_props: MobileToolbarAccessoryProps): null {
    return null
}

// Export the nativeID constant on the fallback too so consumers can
// import TEXT_INPUT_ACCESSORY_ID regardless of platform without
// platform-conditional imports.
export const TEXT_INPUT_ACCESSORY_ID = 'tinycld-text-accessory'
