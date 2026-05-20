import { useUserPreference } from '@tinycld/core/lib/use-user-preference'

export interface NotificationPreferences {
    calendar_reminder: boolean
    calendar_invite: boolean
    calendar_subscription_error: boolean
    mail_new_message: boolean
    drive_file_shared: boolean
    org_invite: boolean
    system_error: boolean
}

const DEFAULT_PREFS: NotificationPreferences = {
    calendar_reminder: true,
    calendar_invite: true,
    calendar_subscription_error: true,
    mail_new_message: true,
    drive_file_shared: true,
    org_invite: true,
    system_error: true,
}

export type MailNotifyMode = 'batched' | 'important_only'

export function useNotificationPreferences() {
    const [prefs, setPrefs] = useUserPreference('notifications', 'preferences', DEFAULT_PREFS)
    const [mailMode, setMailMode] = useUserPreference<MailNotifyMode>(
        'notifications',
        'mail_notify_mode',
        'batched'
    )

    const setTypeEnabled = (type: keyof NotificationPreferences, enabled: boolean) => {
        setPrefs({ ...prefs, [type]: enabled })
    }

    return {
        prefs,
        setPrefs,
        setTypeEnabled,
        mailMode,
        setMailMode,
    }
}
