import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import {
    Drawer,
    DrawerBackdrop,
    DrawerBody,
    DrawerCloseButton,
    DrawerContent,
    DrawerFooter,
    DrawerHeader,
} from '@tinycld/core/ui/drawer'
import { router } from 'expo-router'
import { ArrowLeft, X } from 'lucide-react-native'
import { Pressable, Text, View } from 'react-native'
import { useHelpStore } from '../../lib/help/store'
import { useHelpGroupForPackage, useHelpTopic } from '../../lib/help/use-help-topics'
import { HelpTopicView } from './HelpTopicView'
import { PackageTopicList } from './PackageTopicList'

export function HelpDrawer() {
    const isOpen = useHelpStore(s => s.isOpen)
    const mode = useHelpStore(s => s.mode)
    const topicId = useHelpStore(s => s.topicId)
    const pkgSlug = useHelpStore(s => s.pkgSlug)
    const cameFrom = useHelpStore(s => s.cameFrom)
    const close = useHelpStore(s => s.close)
    const back = useHelpStore(s => s.back)

    const topic = useHelpTopic(topicId)
    const pkgGroup = useHelpGroupForPackage(pkgSlug)
    const muted = useThemeColor('muted-foreground')
    const orgHref = useOrgHref()

    const showBackArrow = mode === 'topic' && cameFrom !== null

    const title = resolveTitle({
        mode,
        topicTitle: topic?.title,
        packageLabel: pkgGroup?.packageName,
    })

    const onReadAll = () => {
        router.push(orgHref('help'))
        close()
    }

    return (
        <Drawer isOpen={isOpen} onClose={close} anchor="right" size="md">
            <DrawerBackdrop />
            <DrawerContent>
                <DrawerHeader>
                    <View className="flex-row items-center justify-between flex-1">
                        <View className="flex-row items-center flex-1">
                            {showBackArrow && (
                                <Pressable
                                    onPress={back}
                                    accessibilityRole="button"
                                    accessibilityLabel="Back to package help"
                                    className="mr-2"
                                >
                                    <ArrowLeft size={18} color={muted} />
                                </Pressable>
                            )}
                            <Text className="text-lg font-semibold text-foreground">{title}</Text>
                        </View>
                        <DrawerCloseButton onPress={close}>
                            <X size={20} color={muted} />
                        </DrawerCloseButton>
                    </View>
                </DrawerHeader>
                <DrawerBody>
                    <DrawerBodyContent mode={mode} topic={topic} pkgSlug={pkgSlug} />
                </DrawerBody>
                <DrawerFooter>
                    <Pressable onPress={onReadAll} accessibilityRole="link">
                        <Text className="text-xs text-muted-foreground hover:underline">
                            Read all tinycld help →
                        </Text>
                    </Pressable>
                </DrawerFooter>
            </DrawerContent>
        </Drawer>
    )
}

interface BodyProps {
    mode: 'topic' | 'package'
    topic: ReturnType<typeof useHelpTopic>
    pkgSlug: string | null
}

function DrawerBodyContent({ mode, topic, pkgSlug }: BodyProps) {
    if (mode === 'package' && pkgSlug) {
        return <PackageTopicList pkgSlug={pkgSlug} />
    }
    if (topic) {
        return <HelpTopicView topic={topic} showTitle={false} />
    }
    return <Text className="text-sm text-muted-foreground">No help topic selected.</Text>
}

interface TitleArgs {
    mode: 'topic' | 'package'
    topicTitle: string | undefined
    packageLabel: string | undefined
}

function resolveTitle({ mode, topicTitle, packageLabel }: TitleArgs): string {
    if (mode === 'topic') return topicTitle ?? 'Help'
    if (packageLabel) return `${packageLabel} help`
    return 'Help'
}
