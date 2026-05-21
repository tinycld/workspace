import { mutation, useMutation } from '@tinycld/core/lib/mutations'
import { useStore } from '@tinycld/core/lib/pocketbase'
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
import { Pencil, Trash2, UserPlus, X } from 'lucide-react-native'
import { newRecordId } from 'pbtsdb/core'
import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { MailboxAliasesPanel } from './MailboxAliasesPanel'
import { MailboxForm, type MailboxFormValues } from './MailboxForm'
import { MailboxMemberRow, type Role } from './MailboxMemberRow'

interface MemberRow {
    id: string
    userOrgId: string
    userName: string
    userEmail: string
    role: Role
    isYou: boolean
}

interface OrgMemberRow {
    userOrgId: string
    userName: string
    userEmail: string
}

interface ViewMailbox {
    id: string
    address: string
    domain: string
    domainName: string
    displayName: string
    type: 'shared' | 'personal'
    createdAt: string
}

export type DrawerMode =
    | { kind: 'closed' }
    | { kind: 'view'; mailboxId: string }
    | { kind: 'create' }
    | { kind: 'edit'; mailboxId: string }

interface Props {
    mode: DrawerMode
    onClose: () => void
    onSwitchToEdit: (mailboxId: string) => void
    onSwitchToView: (mailboxId: string) => void
    mailbox: ViewMailbox | null
    members: MemberRow[]
    orgMembers: OrgMemberRow[]
    domainOptions: Array<{ label: string; value: string }>
    userOrgId: string
}

export function MailboxDrawer({
    mode,
    onClose,
    onSwitchToEdit,
    onSwitchToView,
    mailbox,
    members,
    orgMembers,
    domainOptions,
    userOrgId,
}: Props) {
    const isOpen = mode.kind !== 'closed'
    return (
        <Drawer isOpen={isOpen} onClose={onClose} anchor="right" size="md">
            <DrawerBackdrop />
            <DrawerContent>
                {mode.kind === 'create' && (
                    <CreateView domainOptions={domainOptions} userOrgId={userOrgId} onDone={onClose} />
                )}
                {mode.kind === 'edit' && mailbox && (
                    <EditView
                        mailbox={mailbox}
                        onDone={() => onSwitchToView(mailbox.id)}
                        onCancel={() => onSwitchToView(mailbox.id)}
                    />
                )}
                {mode.kind === 'view' && mailbox && (
                    <ViewMode
                        mailbox={mailbox}
                        members={members}
                        orgMembers={orgMembers}
                        onEdit={() => onSwitchToEdit(mailbox.id)}
                        onDeleted={onClose}
                    />
                )}
            </DrawerContent>
        </Drawer>
    )
}

function CreateView({
    domainOptions,
    userOrgId,
    onDone,
}: {
    domainOptions: Array<{ label: string; value: string }>
    userOrgId: string
    onDone: () => void
}) {
    const mutedColor = useThemeColor('muted-foreground')
    return (
        <>
            <DrawerHeader>
                <View>
                    <Text className="text-foreground" style={{ fontSize: 16, fontWeight: '700' }}>
                        New shared mailbox
                    </Text>
                    <Text className="text-muted-foreground" style={{ fontSize: 12.5, marginTop: 2 }}>
                        Choose an address and display name to get started.
                    </Text>
                </View>
                <DrawerCloseButton onPress={onDone}>
                    <X size={18} color={mutedColor} />
                </DrawerCloseButton>
            </DrawerHeader>
            <DrawerBody>
                <MailboxForm mode="create" domainOptions={domainOptions} userOrgId={userOrgId} onDone={onDone} />
            </DrawerBody>
        </>
    )
}

function EditView({ mailbox, onDone, onCancel }: { mailbox: ViewMailbox; onDone: () => void; onCancel: () => void }) {
    const mutedColor = useThemeColor('muted-foreground')
    const initial: MailboxFormValues = {
        address: mailbox.address,
        domain: mailbox.domain,
        display_name: mailbox.displayName,
    }
    return (
        <>
            <DrawerHeader>
                <View>
                    <Text className="text-foreground" style={{ fontSize: 16, fontWeight: '700' }}>
                        Edit mailbox
                    </Text>
                    <Text className="text-muted-foreground" style={{ fontSize: 12.5, marginTop: 2 }}>
                        {mailbox.address}@{mailbox.domainName}
                    </Text>
                </View>
                <DrawerCloseButton onPress={onCancel}>
                    <X size={18} color={mutedColor} />
                </DrawerCloseButton>
            </DrawerHeader>
            <DrawerBody>
                <MailboxForm
                    mode="edit"
                    mailboxId={mailbox.id}
                    initial={initial}
                    domainName={mailbox.domainName}
                    onDone={onDone}
                />
            </DrawerBody>
        </>
    )
}

function ViewMode({
    mailbox,
    members,
    orgMembers,
    onEdit,
    onDeleted,
}: {
    mailbox: ViewMailbox
    members: MemberRow[]
    orgMembers: OrgMemberRow[]
    onEdit: () => void
    onDeleted: () => void
}) {
    const mutedColor = useThemeColor('muted-foreground')
    const [tab, setTab] = useState<'members' | 'aliases'>(mailbox.type === 'shared' ? 'members' : 'aliases')
    const avatarInitial = (mailbox.displayName || mailbox.address).trim().charAt(0).toUpperCase()

    return (
        <>
            <DrawerHeader>
                <View className="flex-row items-start gap-3 flex-1">
                    <View
                        className="items-center justify-center rounded-lg bg-primary/10"
                        style={{ width: 40, height: 40 }}
                    >
                        <Text className="text-primary" style={{ fontWeight: '700', fontSize: 15 }}>
                            {avatarInitial}
                        </Text>
                    </View>
                    <View className="flex-1" style={{ minWidth: 0 }}>
                        <Text className="text-foreground" style={{ fontSize: 16, fontWeight: '700' }}>
                            {mailbox.address}
                            <Text className="text-muted-foreground" style={{ fontWeight: '500' }}>
                                @{mailbox.domainName}
                            </Text>
                        </Text>
                        <Text className="text-muted-foreground" style={{ fontSize: 12.5, marginTop: 1 }}>
                            {mailbox.displayName}
                        </Text>
                    </View>
                </View>
                <View className="flex-row gap-1">
                    {mailbox.type === 'shared' && (
                        <Pressable className="p-2" onPress={onEdit}>
                            <Pencil size={16} color={mutedColor} />
                        </Pressable>
                    )}
                    <DrawerCloseButton onPress={onDeleted}>
                        <X size={18} color={mutedColor} />
                    </DrawerCloseButton>
                </View>
            </DrawerHeader>

            <View className="flex-row gap-2 items-center flex-wrap" style={{ paddingHorizontal: 4, paddingBottom: 8 }}>
                <TypeBadge type={mailbox.type} />
                <DomainBadge domainName={mailbox.domainName} />
                <Text className="text-muted-foreground" style={{ fontSize: 11 }}>
                    · created {formatCreatedDate(mailbox.createdAt)}
                </Text>
            </View>

            {mailbox.type === 'shared' && (
                <View className="flex-row gap-2" style={{ paddingHorizontal: 4, paddingTop: 4, paddingBottom: 4 }}>
                    <TabButton
                        label={`Members · ${members.length}`}
                        active={tab === 'members'}
                        onPress={() => setTab('members')}
                    />
                    <TabButton label="Aliases" active={tab === 'aliases'} onPress={() => setTab('aliases')} />
                </View>
            )}

            <DrawerBody>
                {mailbox.type === 'shared' && tab === 'members' && (
                    <MembersTab mailboxId={mailbox.id} members={members} orgMembers={orgMembers} />
                )}
                {(mailbox.type === 'personal' || tab === 'aliases') && (
                    <MailboxAliasesPanel
                        mailboxId={mailbox.id}
                        mailboxDomainId={mailbox.domain}
                        domainName={mailbox.domainName}
                    />
                )}
            </DrawerBody>

            {mailbox.type === 'shared' && (
                <DrawerFooter>
                    <DangerZone mailboxId={mailbox.id} onDeleted={onDeleted} />
                </DrawerFooter>
            )}
        </>
    )
}

function TypeBadge({ type }: { type: 'shared' | 'personal' }) {
    const primaryColor = useThemeColor('primary')
    const mutedColor = useThemeColor('muted-foreground')
    const fgColor = useThemeColor('foreground')
    const isShared = type === 'shared'
    return (
        <View
            className="rounded-full"
            style={{
                paddingHorizontal: 8,
                paddingVertical: 2,
                backgroundColor: isShared ? `${primaryColor}1F` : `${mutedColor}26`,
            }}
        >
            <Text
                style={{
                    fontSize: 11,
                    fontWeight: '600',
                    color: isShared ? primaryColor : fgColor,
                }}
            >
                {isShared ? 'Shared' : 'Personal'}
            </Text>
        </View>
    )
}

function DomainBadge({ domainName }: { domainName: string }) {
    return (
        <View
            className="flex-row items-center gap-1 rounded-full border border-border"
            style={{
                paddingHorizontal: 8,
                paddingVertical: 2,
            }}
        >
            <Text className="text-primary" style={{ fontSize: 11, fontWeight: '700' }}>
                ✓
            </Text>
            <Text className="text-muted-foreground" style={{ fontSize: 11, fontWeight: '500' }}>
                {domainName}
            </Text>
        </View>
    )
}

function formatCreatedDate(iso: string): string {
    if (!iso) return '—'
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return '—'
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function TabButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
    const fgColor = useThemeColor('foreground')
    const mutedColor = useThemeColor('muted-foreground')
    const primaryColor = useThemeColor('primary')
    return (
        <Pressable
            onPress={onPress}
            style={{
                paddingVertical: 8,
                paddingHorizontal: 12,
                borderBottomWidth: 2,
                borderBottomColor: active ? primaryColor : 'transparent',
            }}
        >
            <Text
                style={{
                    fontSize: 13,
                    fontWeight: '600',
                    color: active ? fgColor : mutedColor,
                }}
            >
                {label}
            </Text>
        </Pressable>
    )
}

function MembersTab({
    mailboxId,
    members,
    orgMembers,
}: {
    mailboxId: string
    members: MemberRow[]
    orgMembers: OrgMemberRow[]
}) {
    const mutedColor = useThemeColor('muted-foreground')
    const primaryColor = useThemeColor('primary')
    const borderColor = useThemeColor('border')
    const [membersCollection] = useStore('mail_mailbox_members')
    const [adding, setAdding] = useState(false)
    const [selected, setSelected] = useState('')

    const addMutation = useMutation({
        mutationFn: mutation(function* () {
            yield membersCollection.insert({
                id: newRecordId(),
                mailbox: mailboxId,
                user_org: selected,
                role: 'member',
            })
        }),
        onSuccess: () => {
            setAdding(false)
            setSelected('')
        },
    })

    const removeMutation = useMutation({
        mutationFn: mutation(function* (id: string) {
            yield membersCollection.delete(id)
        }),
    })

    const toggleRoleMutation = useMutation({
        mutationFn: mutation(function* ({ id, next }: { id: string; next: Role }) {
            yield membersCollection.update(id, (draft) => {
                draft.role = next
            })
        }),
    })

    const existingIds = new Set(members.map((m) => m.userOrgId))
    const available = orgMembers.filter((o) => !existingIds.has(o.userOrgId))
    const ownerCount = members.filter((m) => m.role === 'owner').length

    return (
        <View className="gap-3">
            <Text
                className="text-muted-foreground"
                style={{
                    fontSize: 11,
                    fontWeight: '600',
                    textTransform: 'uppercase',
                    letterSpacing: 0.6,
                }}
            >
                Who has access
            </Text>
            {members.map((m) => (
                <MailboxMemberRow
                    key={m.id}
                    name={m.userName}
                    email={m.userEmail}
                    isYou={m.isYou}
                    role={m.role}
                    canRemove={!(m.role === 'owner' && ownerCount <= 1)}
                    onToggleRole={() =>
                        toggleRoleMutation.mutate({
                            id: m.id,
                            next: m.role === 'owner' ? 'member' : 'owner',
                        })
                    }
                    onRemove={() => removeMutation.mutate(m.id)}
                />
            ))}

            {!adding && available.length > 0 && (
                <Pressable
                    onPress={() => setAdding(true)}
                    className="flex-row gap-2 items-center rounded-lg p-3 border border-border"
                    style={{ borderStyle: 'dashed' }}
                >
                    <UserPlus size={14} color={mutedColor} />
                    <Text className="text-muted-foreground" style={{ fontSize: 13 }}>
                        Add member
                    </Text>
                </Pressable>
            )}

            {adding && (
                <View className="gap-2 rounded-lg p-3 border border-border" style={{ borderStyle: 'dashed' }}>
                    <Text className="text-muted-foreground" style={{ fontSize: 12 }}>
                        Select a member:
                    </Text>
                    <View className="flex-row gap-1 flex-wrap">
                        {available.map((o) => {
                            const isSelected = selected === o.userOrgId
                            return (
                                <Pressable
                                    key={o.userOrgId}
                                    onPress={() => setSelected(o.userOrgId)}
                                    className="rounded-md px-3"
                                    style={{
                                        paddingVertical: 6,
                                        borderWidth: 1,
                                        borderColor: isSelected ? primaryColor : borderColor,
                                        backgroundColor: isSelected ? `${primaryColor}14` : undefined,
                                    }}
                                >
                                    <Text style={{ fontSize: 12.5 }}>{o.userName}</Text>
                                </Pressable>
                            )
                        })}
                    </View>
                    <View className="flex-row gap-2">
                        <Pressable
                            onPress={() => addMutation.mutate()}
                            disabled={!selected || addMutation.isPending}
                            className="rounded-md"
                            style={{
                                paddingVertical: 7,
                                paddingHorizontal: 12,
                                backgroundColor: primaryColor,
                                opacity: !selected || addMutation.isPending ? 0.5 : 1,
                            }}
                        >
                            <Text className="text-white" style={{ fontSize: 12.5, fontWeight: '600' }}>
                                Add
                            </Text>
                        </Pressable>
                        <Pressable
                            onPress={() => {
                                setAdding(false)
                                setSelected('')
                            }}
                            className="rounded-md"
                            style={{ paddingVertical: 7, paddingHorizontal: 10 }}
                        >
                            <Text style={{ fontSize: 12.5 }}>Cancel</Text>
                        </Pressable>
                    </View>
                </View>
            )}
        </View>
    )
}

function DangerZone({ mailboxId, onDeleted }: { mailboxId: string; onDeleted: () => void }) {
    const dangerColor = useThemeColor('danger')
    const [mailboxesCollection] = useStore('mail_mailboxes')
    const [confirming, setConfirming] = useState(false)

    const deleteMutation = useMutation({
        mutationFn: mutation(function* () {
            yield mailboxesCollection.delete(mailboxId)
        }),
        onSuccess: () => {
            setConfirming(false)
            onDeleted()
        },
    })

    return (
        <View className="flex-row items-center justify-between gap-3">
            <View className="flex-1">
                <Text className="text-foreground" style={{ fontSize: 12.5, fontWeight: '600' }}>
                    Delete this mailbox.
                </Text>
                <Text className="text-muted-foreground" style={{ fontSize: 11.5 }}>
                    Members lose access. Aliases are freed. Messages stay on disk.
                </Text>
            </View>
            {!confirming ? (
                <Pressable
                    onPress={() => setConfirming(true)}
                    className="rounded-md"
                    style={{
                        paddingVertical: 6,
                        paddingHorizontal: 10,
                        borderWidth: 1,
                        borderColor: `${dangerColor}55`,
                    }}
                >
                    <View className="flex-row gap-1.5 items-center">
                        <Trash2 size={14} color={dangerColor} />
                        <Text style={{ color: dangerColor, fontSize: 12, fontWeight: '600' }}>Delete</Text>
                    </View>
                </Pressable>
            ) : (
                <View className="flex-row gap-2">
                    <Pressable
                        onPress={() => setConfirming(false)}
                        className="rounded-md"
                        style={{ paddingVertical: 6, paddingHorizontal: 10 }}
                    >
                        <Text style={{ fontSize: 12, fontWeight: '600' }}>Cancel</Text>
                    </Pressable>
                    <Pressable
                        onPress={() => deleteMutation.mutate()}
                        className="rounded-md"
                        style={{
                            paddingVertical: 6,
                            paddingHorizontal: 10,
                            backgroundColor: dangerColor,
                        }}
                    >
                        <Text className="text-white" style={{ fontSize: 12, fontWeight: '600' }}>
                            Really delete
                        </Text>
                    </Pressable>
                </View>
            )}
        </View>
    )
}
