import { ToolbarIconButton } from '@tinycld/core/components/ToolbarIconButton'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Upload } from 'lucide-react-native'
import { type ChangeEvent, useId } from 'react'
import { Platform } from 'react-native'
import { useDrive } from '../hooks/useDrive'

interface UploadButtonProps {
    /** Label exposed to assistive tech and rendered as the button's aria-label / native title. */
    label?: string
    /** Mobile-only fallback handler, e.g. opening the action sheet. Web ignores this. */
    onMobilePress?: () => void
}

/**
 * Upload trigger that, on web, wraps a hidden <input type="file"> in a <label>
 * so clicking the button is treated by the browser as a direct activation of the
 * input — preserving the user-gesture context that React Native Web's Pressable
 * sometimes loses through its synthetic event pipeline. On native, falls back to
 * the action-sheet handler.
 */
export function UploadButton({ label = 'Upload', onMobilePress }: UploadButtonProps) {
    const inputId = useId()
    const mutedColor = useThemeColor('muted-foreground')
    const hoverBg = useThemeColor('hover-background')
    const { uploadFiles } = useDrive()

    if (Platform.OS !== 'web') {
        return <ToolbarIconButton icon={Upload} label={label} onPress={onMobilePress} />
    }

    const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
        const list = e.target.files
        if (list && list.length > 0) {
            uploadFiles(Array.from(list))
        }
        // Reset so picking the same file twice fires another change event.
        e.target.value = ''
    }

    return (
        <label
            htmlFor={inputId}
            title={label}
            aria-label={label}
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 8,
                borderRadius: 9999,
                cursor: 'pointer',
                color: mutedColor,
            }}
            onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = hoverBg
            }}
            onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent'
            }}
        >
            <Upload size={18} color={mutedColor} />
            <input
                id={inputId}
                type="file"
                multiple
                onChange={handleChange}
                style={{
                    position: 'absolute',
                    width: 1,
                    height: 1,
                    padding: 0,
                    margin: -1,
                    overflow: 'hidden',
                    clip: 'rect(0,0,0,0)',
                    border: 0,
                }}
            />
        </label>
    )
}
