import { Baseline } from 'lucide-react-native'
import { View } from 'react-native'
import { ColorPickerMenu } from './ColorPickerMenu'

interface TextColorMenuProps {
    color: string | undefined
    disabled: boolean
    onSetColor: (color: string) => void
}

// Trigger icon is the underlined "A" from Lucide. The bar under it is
// tinted to the active color when one is set so the user can see the
// current selection at a glance — matches Google Sheets' affordance.
export function TextColorMenu({ color, disabled, onSetColor }: TextColorMenuProps) {
    const showBar = typeof color === 'string' && color !== ''
    return (
        <ColorPickerMenu
            color={color}
            disabled={disabled}
            label="Text color"
            triggerIcon={Baseline}
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
