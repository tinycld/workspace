import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import type { LucideIcon } from 'lucide-react-native'
import type React from 'react'
import { forwardRef } from 'react'
import { Platform, Pressable, type View } from 'react-native'

interface ToolbarIconButtonProps {
    icon: LucideIcon
    label: string
    onPress?: () => void
    size?: number
    color?: string
    disabled?: boolean
}

export const ToolbarIconButton = forwardRef<View, ToolbarIconButtonProps>(
    function ToolbarIconButton({ icon: Icon, label, onPress, size = 18, color, disabled }, ref) {
        const mutedColor = useThemeColor('muted-foreground')
        const iconColor = color ?? mutedColor

        if (Platform.OS === 'web') {
            return (
                <button
                    type="button"
                    title={label}
                    aria-label={label}
                    disabled={disabled}
                    onClick={onPress as unknown as React.MouseEventHandler}
                    style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: 8,
                        borderRadius: '100%',
                        border: 'none',
                        background: 'transparent',
                        cursor: disabled ? 'default' : 'pointer',
                        opacity: disabled ? 0.4 : 1,
                    }}
                    className="hover:bg-hover-background active:bg-hover-background"
                >
                    <Icon size={size} color={iconColor} />
                </button>
            )
        }

        return (
            <Pressable
                ref={ref}
                className="p-3 rounded-full hover:bg-hover-background active:bg-hover-background"
                style={{ opacity: disabled ? 0.4 : 1 }}
                onPress={onPress}
                accessibilityRole="button"
                accessibilityLabel={label}
                disabled={disabled}
            >
                <Icon size={size} color={iconColor} />
            </Pressable>
        )
    }
)
