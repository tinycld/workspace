import { ChangeServerLink } from '@tinycld/core/components/ChangeServerLink'
import { ReviewModeHints } from '@tinycld/core/components/connect/ReviewModeHints'
import { useAuth } from '@tinycld/core/lib/auth'
import { navigateToOrg } from '@tinycld/core/lib/org-url'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useState } from 'react'
import {
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    Text,
    TextInput,
    View,
} from 'react-native'

export function LoginModal() {
    const mutedColor = useThemeColor('muted-foreground')
    const primaryFg = useThemeColor('primary-foreground')
    const backdropColor = useThemeColor('overlay-backdrop')
    const { login } = useAuth({ throwIfAnon: false })
    const [identifier, setIdentifier] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [isSubmitting, setIsSubmitting] = useState(false)

    const canSubmit = identifier.trim().length > 0 && password.length > 0 && !isSubmitting

    const handleSubmit = async () => {
        if (!canSubmit) return
        setError(null)
        setIsSubmitting(true)
        const result = await login(identifier.trim(), password)
        if (result.error) {
            setError(result.error)
            setIsSubmitting(false)
        } else if (result.user?.primaryOrgSlug) {
            navigateToOrg(result.user.primaryOrgSlug)
        }
    }

    return (
        <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            className="absolute top-0 left-0 right-0 bottom-0 justify-center items-center"
            style={{
                zIndex: 200,
                backgroundColor: backdropColor,
            }}
        >
            <View
                className="rounded-2xl border border-border p-8 bg-background"
                style={{
                    width: 400,
                    maxWidth: '90%',
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 8 },
                    shadowOpacity: 0.15,
                    shadowRadius: 24,
                    elevation: 8,
                }}
            >
                <Text className="text-[22px] font-bold mb-1 text-foreground">Sign in</Text>
                <Text className="text-sm mb-6 text-muted-foreground">
                    Sign in to your account to continue
                </Text>

                {error && (
                    <View className="rounded-lg p-3 mb-4 bg-danger-soft">
                        <Text className="text-sm text-danger">{error}</Text>
                    </View>
                )}

                <View className="mb-4">
                    <Text className="mb-1.5 text-sm font-semibold text-foreground">
                        Username or email
                    </Text>
                    <TextInput
                        className="border border-border rounded-lg p-3 text-base text-foreground bg-surface-secondary"
                        testID="identifier"
                        value={identifier}
                        onChangeText={setIdentifier}
                        placeholder="alice or alice@company.com"
                        placeholderTextColor={mutedColor}
                        autoCapitalize="none"
                        autoCorrect={false}
                        autoComplete="username"
                        editable={!isSubmitting}
                    />
                </View>

                <View className="mb-4">
                    <Text className="mb-1.5 text-sm font-semibold text-foreground">Password</Text>
                    <TextInput
                        className="border border-border rounded-lg p-3 text-base text-foreground bg-surface-secondary"
                        testID="login-password"
                        value={password}
                        onChangeText={setPassword}
                        placeholder="Password"
                        placeholderTextColor={mutedColor}
                        secureTextEntry
                        autoComplete="current-password"
                        editable={!isSubmitting}
                        onSubmitEditing={handleSubmit}
                    />
                </View>

                <Pressable
                    testID="login-submit"
                    className={`rounded-lg items-center mt-2 p-3.5 bg-primary ${canSubmit ? 'opacity-100' : 'opacity-50'}`}
                    onPress={handleSubmit}
                    disabled={!canSubmit}
                >
                    {isSubmitting ? (
                        <ActivityIndicator color={primaryFg} size="small" />
                    ) : (
                        <Text className="text-base font-semibold text-primary-foreground">
                            Sign in
                        </Text>
                    )}
                </Pressable>

                <ReviewModeHints
                    onPrefill={(id, password) => {
                        setIdentifier(id)
                        setPassword(password)
                    }}
                />

                <View className="mt-4 items-center">
                    <ChangeServerLink />
                </View>
            </View>
        </KeyboardAvoidingView>
    )
}
