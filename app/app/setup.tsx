import { SetupPage } from '@tinycld/core/components/setup/SetupPage'
import { useLocalSearchParams } from 'expo-router'

export default function Setup() {
    const { token } = useLocalSearchParams<{ token?: string }>()
    return <SetupPage token={token} />
}
