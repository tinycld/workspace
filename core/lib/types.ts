export interface UserSession {
    id: string
    name: string
    email: string
    primaryOrgSlug?: string
    /** True for sandboxed demo accounts. Outbound side effects (mail send,
     *  invite email, share email, expo push) are suppressed server-side. The
     *  UI uses this flag to show a persistent "Demo" banner. */
    isDemo: boolean
    /** Mirrors users.metadata.isBetaTester in PocketBase. When true, the EAS
     *  Update channel override (useAppUpdates) routes this user's binary to
     *  the preview channel — early access to OTA bundles without a new
     *  TestFlight build. Set the JSON value by hand against an individual
     *  user in the PocketBase admin (no UI yet). */
    isBetaTester: boolean
}
