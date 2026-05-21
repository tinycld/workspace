import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { AlertTriangle, X } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import {
    formatImportWarning,
    type ImportWarning,
    importWarningTitle,
} from './import-warning-format'

export type { ImportWarning } from './import-warning-format'

interface ImportWarningBannerProps {
    warnings: ImportWarning[]
}

// Dismissable banner shown above the editor when the server reports
// .docx → ProseMirror translation warnings (e.g. unsupported feature
// dropped, image inlined as data: URI). The user can dismiss the
// banner; the warnings are not persisted, so refreshing the page brings
// it back. v1 ships a flat list — categorisation can come later if the
// volume warrants it.
export function ImportWarningBanner({ warnings }: ImportWarningBannerProps) {
    const [dismissed, setDismissed] = useState(false)
    const warningColor = useThemeColor('warning')
    const mutedColor = useThemeColor('muted-foreground')

    if (dismissed || warnings.length === 0) return null

    return (
        <View className="px-4 py-2 border-b border-border bg-warning/10 flex-row items-start gap-2">
            <AlertTriangle size={16} color={warningColor} />
            <View className="flex-1 gap-1">
                <Text className="text-sm font-medium text-foreground">
                    {importWarningTitle(warnings.length)}
                </Text>
                {warnings.map((w, i) => (
                    <Text key={`${w.code}-${i}`} className="text-xs text-muted-foreground">
                        {formatImportWarning(w)}
                    </Text>
                ))}
            </View>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Dismiss import warnings"
                onPress={() => setDismissed(true)}
                hitSlop={8}
            >
                <X size={16} color={mutedColor} />
            </Pressable>
        </View>
    )
}
