import { eq } from '@tanstack/db'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'

export type MailSendBlocker = 'no-mailbox' | 'no-domain' | 'domain-unverified'

export interface MailSendReadiness {
    mailboxId: string | null
    blocker: MailSendBlocker | null
    message: string | null
}

export function useMailSendReadiness(): MailSendReadiness {
    const [membersCollection, mailboxesCollection, domainsCollection] = useStore(
        'mail_mailbox_members',
        'mail_mailboxes',
        'mail_domains'
    )

    const { data: members } = useOrgLiveQuery((query, { userOrgId }) =>
        query
            .from({ mail_mailbox_members: membersCollection })
            .where(({ mail_mailbox_members }) => eq(mail_mailbox_members.user_org, userOrgId))
    )

    const mailboxId = members?.[0]?.mailbox ?? null

    const { data: mailboxes } = useOrgLiveQuery(
        (query) =>
            query
                .from({ mail_mailboxes: mailboxesCollection })
                .where(({ mail_mailboxes }) => eq(mail_mailboxes.id, mailboxId ?? '')),
        [mailboxId]
    )

    const domainId = mailboxes?.[0]?.domain ?? null

    const { data: domains } = useOrgLiveQuery(
        (query) =>
            query
                .from({ mail_domains: domainsCollection })
                .where(({ mail_domains }) => eq(mail_domains.id, domainId ?? '')),
        [domainId]
    )

    const domain = domains?.[0] ?? null

    if (!mailboxId) {
        return {
            mailboxId: null,
            blocker: 'no-mailbox',
            message: 'No mailbox found. Ask your admin to add you to a mailbox.',
        }
    }

    if (!domain) {
        return {
            mailboxId,
            blocker: 'no-domain',
            message: 'Mailbox exists but its sending domain is missing. An admin must configure a mail domain.',
        }
    }

    if (!domain.verified) {
        return {
            mailboxId,
            blocker: 'domain-unverified',
            message: `The domain "${domain.domain}" is not verified. Outgoing mail will fail until an admin completes verification in Settings → Mail.`,
        }
    }

    return { mailboxId, blocker: null, message: null }
}
