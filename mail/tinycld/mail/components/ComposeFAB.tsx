import { FAB } from '@tinycld/core/components/FAB'
import { Pencil } from 'lucide-react-native'
import { composeEvents } from '../hooks/composeEvents'

interface ComposeFABProps {
    isVisible: boolean
}

export function ComposeFAB({ isVisible }: ComposeFABProps) {
    return (
        <FAB
            icon={Pencil}
            onPress={() => composeEvents.emit()}
            accessibilityLabel="Compose email"
            isVisible={isVisible}
        />
    )
}
