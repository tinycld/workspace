import { type ReactNode, useRef } from 'react'
import { TextInput, View } from 'react-native'
import { KeyboardExtendedView } from 'react-native-external-keyboard'
import { createMatcher } from './matcher'

export interface ShortcutsProviderProps {
    children: ReactNode
}

interface KeyPress {
    keyCode: number
    unicode: number
    unicodeChar: string
    isLongPress: boolean
    isAltPressed: boolean
    isShiftPressed: boolean
    isCtrlPressed: boolean
    isCapsLockOn: boolean
    hasNoModifiers: boolean
}

/**
 * Translate a native KeyPress event to a tinykeys-style atom string.
 *
 *   "g"           → printable single key, no mods
 *   "Shift+C"     → Shift + printable
 *   "$mod+Enter"  → Ctrl/Cmd + special
 *   null          → ignore (e.g. pure modifier key down)
 */
function keyPressToAtom(e: KeyPress): string | null {
    const named = namedKeyFromCode(e.keyCode, e.unicodeChar)
    const base = named ?? (e.unicodeChar && e.unicodeChar.length > 0 ? e.unicodeChar : null)
    if (!base) return null

    const parts: string[] = []
    if (e.isCtrlPressed) parts.push('$mod')
    // Only treat Shift as a modifier when combined with a named key or with
    // a letter whose unicode case we preserve — otherwise we would double-
    // count Shift+g as "Shift+G" when the user's intent is a capital G.
    if (e.isShiftPressed && named) parts.push('Shift')
    if (e.isAltPressed) parts.push('Alt')

    if (parts.length === 0) return base
    return [...parts, base].join('+')
}

function namedKeyFromCode(keyCode: number, char: string): string | null {
    // Android KeyEvent keycodes for the common special keys we care about.
    // unicodeChar is empty for non-printable keys, so rely on keyCode.
    if (char) return null
    switch (keyCode) {
        case 66: // ENTER
        case 160: // NUMPAD_ENTER
            return 'Enter'
        case 111: // ESCAPE
            return 'Escape'
        case 61: // TAB
            return 'Tab'
        case 62: // SPACE
            return ' '
        case 67: // DEL (backspace)
            return 'Backspace'
        case 112: // FORWARD_DEL
            return 'Delete'
        case 19: // DPAD_UP
            return 'ArrowUp'
        case 20: // DPAD_DOWN
            return 'ArrowDown'
        case 21: // DPAD_LEFT
            return 'ArrowLeft'
        case 22: // DPAD_RIGHT
            return 'ArrowRight'
        default:
            return null
    }
}

function isTextInputFocused(): boolean {
    // React Native exposes a single global text input focus state.
    // biome-ignore lint/suspicious/noExplicitAny: State() is not in public RN types
    const currentlyFocused = (TextInput as any).State?.currentlyFocusedInput?.()
    return currentlyFocused != null
}

export function ShortcutsProvider({ children }: ShortcutsProviderProps) {
    const matcherRef = useRef(createMatcher())

    const handleKeyDown = (event: { nativeEvent: KeyPress }) => {
        const atom = keyPressToAtom(event.nativeEvent)
        if (!atom) return
        matcherRef.current.feedAtom(atom, { inInput: isTextInputFocused() })
    }

    return (
        <KeyboardExtendedView
            onKeyDownPress={handleKeyDown}
            canBeFocused={true}
            autoFocus={true}
            haloEffect={false}
            focusable={false}
            style={{ flex: 1 }}
        >
            <View className="flex-1">{children}</View>
        </KeyboardExtendedView>
    )
}
