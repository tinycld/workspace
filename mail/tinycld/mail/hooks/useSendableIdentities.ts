import { eq } from '@tanstack/db'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'
import { useMemo } from 'react'
import { flattenSendableIdentities } from './flattenSendableIdentities'
import { useMailboxes } from './useMailboxes'

export type { SendableIdentity } from './flattenSendableIdentities'
export { flattenSendableIdentities }

export function useSendableIdentities() {
    const [aliasesCollection, domainsCollection] = useStore('mail_mailbox_aliases', 'mail_domains')
    const { personal, shared } = useMailboxes()

    const { data: allAliases } = useOrgLiveQuery((query) => query.from({ mail_mailbox_aliases: aliasesCollection }))
    const { data: allDomains } = useOrgLiveQuery((query, { orgId }) =>
        query.from({ mail_domains: domainsCollection }).where(({ mail_domains }) => eq(mail_domains.org, orgId))
    )

    return useMemo(() => {
        const mailboxes = [personal, ...shared].filter((mb): mb is NonNullable<typeof mb> => mb != null)
        return flattenSendableIdentities(mailboxes, allAliases ?? [], allDomains ?? [])
    }, [personal, shared, allAliases, allDomains])
}
