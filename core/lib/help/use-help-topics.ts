import { packageHelp } from '@tinycld/app-generated/package-help'
import { useMemo } from 'react'
import type { HelpGroup, HelpTopic, HelpTopicId } from './types'

const groups = packageHelp as unknown as HelpGroup[]
const flat: HelpTopic[] = groups.flatMap(g => g.topics) as HelpTopic[]
const byId = new Map<string, HelpTopic>(flat.map(t => [t.id, t]))

export function useHelpGroups(): HelpGroup[] {
    return groups
}

export function useHelpTopics(): HelpTopic[] {
    return flat
}

export function useHelpTopic(id: HelpTopicId | null | undefined): HelpTopic | null {
    return useMemo(() => (id ? (byId.get(id) ?? null) : null), [id])
}

export function useHelpGroupForPackage(pkgSlug: string | null | undefined): HelpGroup | null {
    return useMemo(
        () => (pkgSlug ? (groups.find(g => g.pkgSlug === pkgSlug) ?? null) : null),
        [pkgSlug]
    )
}
