import { eq } from '@tanstack/db'
import { MemberAvatar } from '@tinycld/core/components/settings/members/MemberAvatar'
import { mutation, useMutation } from '@tinycld/core/lib/mutations'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'
import { Button, ButtonText } from '@tinycld/core/ui/button'
import { Modal, ModalBackdrop, ModalContent } from '@tinycld/core/ui/modal'
import { Search, X } from 'lucide-react-native'
import { newRecordId } from 'pbtsdb/core'
import { useMemo, useState } from 'react'
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { type CalendarRole, ROLE_OPTIONS } from './roles'

interface AddMemberDialogProps {
    isVisible: boolean
    calendarId: string
    existingUserOrgIds: Set<string>
    onClose: () => void
}

export function AddMemberDialog({
    isVisible,
    calendarId,
    existingUserOrgIds,
    onClose,
}: AddMemberDialogProps) {
    const mutedColor = useThemeColor('muted-foreground')
    const fgColor = useThemeColor('foreground')
    const [query, setQuery] = useState('')
    const [role, setRole] = useState<CalendarRole>('viewer')
    const [errorMessage, setErrorMessage] = useState<string | null>(null)

    const [userOrgCollection, usersCollection, membersCollection] = useStore(
        'user_org',
        'users',
        'calendar_members'
    )

    const { data: candidatesRaw } = useOrgLiveQuery((q, { orgId }) =>
        q
            .from({ uo: userOrgCollection })
            .join({ u: usersCollection }, ({ uo, u }) => eq(uo.user, u.id))
            .where(({ uo }) => eq(uo.org, orgId))
            .select(({ uo, u }) => ({
                userOrgId: uo.id,
                userId: uo.user,
                name: u.name,
                email: u.email,
            }))
    )

    const filteredCandidates = useMemo(() => {
        const all = candidatesRaw ?? []
        const q = query.trim().toLowerCase()
        return all
            .filter(c => !existingUserOrgIds.has(c.userOrgId))
            .filter(c => {
                if (!q) return true
                return (
                    (c.name ?? '').toLowerCase().includes(q) ||
                    (c.email ?? '').toLowerCase().includes(q)
                )
            })
            .slice(0, 20)
    }, [candidatesRaw, existingUserOrgIds, query])

    const addMember = useMutation({
        mutationFn: mutation(function* (input: { userOrgId: string; role: CalendarRole }) {
            yield membersCollection.insert({
                id: newRecordId(),
                calendar: calendarId,
                user_org: input.userOrgId,
                role: input.role,
                // color is select-with-no-default — pbtsdb's generated type
                // marks it required, and PB's create-rule may stricter-check
                // it than the schema suggests. Pick a sensible default.
                color: 'blue',
            })
        }),
        onSuccess: () => {
            setQuery('')
            setRole('viewer')
            setErrorMessage(null)
            onClose()
        },
        onError: error => {
            const msg = error instanceof Error ? error.message : 'Failed to add member'
            setErrorMessage(msg)
        },
    })

    const handleAdd = (userOrgId: string) => {
        setErrorMessage(null)
        addMember.mutate({ userOrgId, role })
    }

    const handleClose = () => {
        setQuery('')
        setRole('viewer')
        setErrorMessage(null)
        onClose()
    }

    return (
        <Modal isOpen={isVisible} onClose={handleClose}>
            <ModalBackdrop />
            <ModalContent className="w-[480px] max-h-[600px] p-0 rounded-xl">
                <View className="flex-row items-center justify-between px-4 py-3 border-b border-border">
                    <Text className="text-lg font-semibold text-foreground">Add people</Text>
                    <Pressable onPress={handleClose} className="p-1">
                        <X size={18} color={mutedColor} />
                    </Pressable>
                </View>

                <View className="px-4 pt-3 pb-2 gap-3">
                    <View className="flex-row items-center gap-2 px-3 py-2 rounded-md border border-border bg-background">
                        <Search size={16} color={mutedColor} />
                        <TextInput
                            value={query}
                            onChangeText={setQuery}
                            placeholder="Search by name or email"
                            className="flex-1 text-foreground"
                            style={{ fontSize: 14, color: fgColor, outlineWidth: 0 } as object}
                            placeholderTextColor={mutedColor}
                            autoFocus
                        />
                    </View>

                    <View className="flex-row gap-1.5 items-center">
                        <Text className="text-xs text-muted-foreground">Role:</Text>
                        {ROLE_OPTIONS.map(opt => {
                            const isSelected = role === opt.value
                            return (
                                <Pressable
                                    key={opt.value}
                                    onPress={() => setRole(opt.value)}
                                    className={
                                        isSelected
                                            ? 'px-2.5 py-1 rounded-md bg-primary'
                                            : 'px-2.5 py-1 rounded-md border border-border'
                                    }
                                >
                                    <Text
                                        className={
                                            isSelected
                                                ? 'text-primary-foreground text-xs'
                                                : 'text-foreground text-xs'
                                        }
                                    >
                                        {opt.label}
                                    </Text>
                                </Pressable>
                            )
                        })}
                    </View>

                    {errorMessage ? (
                        <View className="px-3 py-2 rounded-md bg-danger-soft">
                            <Text className="text-danger text-xs">{errorMessage}</Text>
                        </View>
                    ) : null}
                </View>

                <ScrollView className="max-h-[360px]" contentContainerStyle={{ paddingBottom: 12 }}>
                    {filteredCandidates.length === 0 ? (
                        <View className="px-4 py-6">
                            <Text className="text-muted-foreground text-sm">
                                {query
                                    ? 'No matching org members'
                                    : 'Everyone in this org is already a member of this calendar'}
                            </Text>
                        </View>
                    ) : (
                        filteredCandidates.map(c => (
                            <View
                                key={c.userOrgId}
                                className="flex-row items-center gap-3 px-4 py-2.5"
                            >
                                <MemberAvatar
                                    name={c.name ?? ''}
                                    email={c.email ?? ''}
                                    size={32}
                                />
                                <View className="flex-1">
                                    <Text
                                        className="text-foreground font-medium"
                                        style={{ fontSize: 14 }}
                                    >
                                        {c.name || c.email}
                                    </Text>
                                    {c.name ? (
                                        <Text
                                            className="text-muted-foreground"
                                            style={{ fontSize: 12 }}
                                        >
                                            {c.email}
                                        </Text>
                                    ) : null}
                                </View>
                                <Button
                                    size="sm"
                                    onPress={() => handleAdd(c.userOrgId)}
                                    isDisabled={addMember.isPending}
                                >
                                    <ButtonText>
                                        {addMember.isPending ? 'Adding…' : 'Add'}
                                    </ButtonText>
                                </Button>
                            </View>
                        ))
                    )}
                </ScrollView>
            </ModalContent>
        </Modal>
    )
}
