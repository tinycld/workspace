import type { LucideIcon } from 'lucide-react-native'
import type { ReactNode, RefObject } from 'react'
import { createContext, useCallback, useContext, useRef } from 'react'
import { Platform, Pressable, Text, View } from 'react-native'
import type { SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable'

export interface SwipeAction {
    icon: LucideIcon
    label: string
    onPress: () => void
    backgroundColor: string
}

interface SwipeableRowContextValue {
    register: (ref: RefObject<SwipeableMethods | null>) => void
    unregister: (ref: RefObject<SwipeableMethods | null>) => void
    closeOthers: (ref: RefObject<SwipeableMethods | null>) => void
}

const SwipeableRowContext = createContext<SwipeableRowContextValue | null>(null)

export function SwipeableRowProvider({ children }: { children: ReactNode }) {
    const openRefs = useRef(new Set<RefObject<SwipeableMethods | null>>())

    const register = useCallback((ref: RefObject<SwipeableMethods | null>) => {
        openRefs.current.add(ref)
    }, [])

    const unregister = useCallback((ref: RefObject<SwipeableMethods | null>) => {
        openRefs.current.delete(ref)
    }, [])

    const closeOthers = useCallback((ref: RefObject<SwipeableMethods | null>) => {
        for (const r of openRefs.current) {
            if (r !== ref) r.current?.close()
        }
    }, [])

    return (
        <SwipeableRowContext.Provider value={{ register, unregister, closeOthers }}>
            {children}
        </SwipeableRowContext.Provider>
    )
}

function RightActions({
    actions,
    onActionPress,
}: {
    actions: SwipeAction[]
    onActionPress: (action: SwipeAction) => void
}) {
    return (
        <View className="flex-row">
            {actions.map(action => (
                <Pressable
                    key={action.label}
                    className="w-[72px] justify-center items-center gap-1"
                    style={{ backgroundColor: action.backgroundColor }}
                    onPress={() => onActionPress(action)}
                >
                    <action.icon size={20} color="#ffffff" />
                    <Text className="text-white text-[10px] font-semibold">{action.label}</Text>
                </Pressable>
            ))}
        </View>
    )
}

function NativeSwipeableRow({
    actions,
    children,
    enabled = true,
}: {
    actions: SwipeAction[]
    children: ReactNode
    enabled?: boolean
}) {
    // Dynamic import to avoid loading reanimated on web
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ReanimatedSwipeable: typeof import('react-native-gesture-handler/ReanimatedSwipeable').default =
        require('react-native-gesture-handler/ReanimatedSwipeable').default

    const swipeableRef = useRef<SwipeableMethods | null>(null)
    const ctx = useContext(SwipeableRowContext)

    const registerRef = useRef(false)
    if (!registerRef.current && ctx) {
        ctx.register(swipeableRef)
        registerRef.current = true
    }

    const handleOpen = useCallback(() => {
        ctx?.closeOthers(swipeableRef)
    }, [ctx])

    const handleActionPress = useCallback((action: SwipeAction) => {
        swipeableRef.current?.close()
        action.onPress()
    }, [])

    const renderRightActions = useCallback(
        () => <RightActions actions={actions} onActionPress={handleActionPress} />,
        [actions, handleActionPress]
    )

    return (
        <ReanimatedSwipeable
            ref={swipeableRef}
            renderRightActions={renderRightActions}
            onSwipeableOpen={handleOpen}
            rightThreshold={40}
            overshootRight={false}
            enabled={enabled}
            containerStyle={swipeContainerStyle}
        >
            {children}
        </ReanimatedSwipeable>
    )
}

export function SwipeableRow({
    actions,
    children,
    enabled = true,
}: {
    actions: SwipeAction[]
    children: ReactNode
    enabled?: boolean
}) {
    if (Platform.OS === 'web') return <>{children}</>

    return (
        <NativeSwipeableRow actions={actions} enabled={enabled}>
            {children}
        </NativeSwipeableRow>
    )
}

const swipeContainerStyle = { overflow: 'hidden' as const }
