import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { FormErrorSummary, TextInput, useForm, z, zodResolver } from '@tinycld/core/ui/form'
import { Lock } from 'lucide-react-native'
import { Pressable, Text, View } from 'react-native'

const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1, 'Password is required'),
})

interface SuperuserLoginFormProps {
    login: (email: string, password: string) => Promise<void>
    error: string | null
    isLoading: boolean
}

export function SuperuserLoginForm({ login, error, isLoading }: SuperuserLoginFormProps) {
    const fgColor = useThemeColor('foreground')
    const {
        control,
        handleSubmit,
        formState: { errors, isSubmitted },
    } = useForm({
        resolver: zodResolver(loginSchema),
        defaultValues: { email: '', password: '' },
        mode: 'onChange',
    })

    const onSubmit = handleSubmit(data => login(data.email, data.password))

    return (
        <View
            className="gap-4 p-5 self-center rounded-xl border border-border bg-surface-secondary"
            style={{ maxWidth: 380, width: '90%' }}
        >
            <View className="gap-2 items-center">
                <View className="size-10 rounded-lg items-center justify-center bg-surface">
                    <Lock size={18} color={fgColor} />
                </View>
                <Text className="text-xl font-bold text-foreground">Superuser Login</Text>
                <Text className="text-center text-xs text-muted-foreground">
                    Authenticate with PocketBase to manage organizations.
                </Text>
            </View>

            <FormErrorSummary errors={errors} isEnabled={isSubmitted} />

            {error && (
                <View className="rounded-lg p-2 bg-danger-soft">
                    <Text className="text-xs text-danger">{error}</Text>
                </View>
            )}

            <TextInput
                control={control}
                name="email"
                label="Email"
                placeholder="admin@example.com"
                keyboardType="email-address"
                autoCapitalize="none"
            />

            <TextInput
                control={control}
                name="password"
                label="Password"
                placeholder="Password"
                secureTextEntry
            />

            <Pressable
                onPress={onSubmit}
                disabled={isLoading}
                className={`px-4 py-3 rounded-lg items-center bg-primary ${isLoading ? 'opacity-60' : 'opacity-100'}`}
            >
                <Text className="font-semibold text-primary-foreground">
                    {isLoading ? 'Signing in...' : 'Sign in'}
                </Text>
            </Pressable>
        </View>
    )
}
