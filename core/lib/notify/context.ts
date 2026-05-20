export type NotifyContext = {
    orgId: string
    userId: string
}

let current: NotifyContext | null = null

export function setNotifyContext(ctx: NotifyContext): void {
    current = ctx
}

export function clearNotifyContext(): void {
    current = null
}

export function getNotifyContext(): NotifyContext | null {
    return current
}
