import { PaintBucket } from 'lucide-react-native'
import { View } from 'react-native'
import { ColorPickerMenu } from './ColorPickerMenu'

interface FillColorMenuProps {
    color: string | undefined
    disabled: boolean
    onSetColor: (color: string) => void
}

// Cell background ("fill") color. Stored under cell.style.fill.fgColor —
// the render path already maps fgColor → backgroundColor.
export function FillColorMenu({ color, disabled, onSetColor }: FillColorMenuProps) {
    const showBar = typeof color === 'string' && color !== ''
    return (
        <ColorPickerMenu
            color={color}
            disabled={disabled}
            label="Fill color"
            triggerIcon={PaintBucket}
            triggerOverlay={
                showBar ? (
                    <View
                        style={{
                            position: 'absolute',
                            left: 1,
                            right: 1,
                            bottom: 0,
                            height: 2,
                            backgroundColor: color,
                        }}
                    />
                ) : null
            }
            onSetColor={onSetColor}
        />
    )
}
