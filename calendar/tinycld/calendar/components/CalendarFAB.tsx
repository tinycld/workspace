import { FAB } from '@tinycld/core/components/FAB'
import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { useRouter } from 'expo-router'
import { Plus } from 'lucide-react-native'

interface CalendarFABProps {
    isVisible: boolean
}

export function CalendarFAB({ isVisible }: CalendarFABProps) {
    const router = useRouter()
    const orgHref = useOrgHref()

    return (
        <FAB
            icon={Plus}
            onPress={() => router.push(orgHref('calendar/[id]', { id: 'new' }))}
            accessibilityLabel="Create event"
            isVisible={isVisible}
            iconSize={24}
        />
    )
}
