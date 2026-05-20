export type HelpTopicId = `${string}:${string}`

export interface HelpTopic {
    id: HelpTopicId
    pkgSlug: string
    topicId: string
    title: string
    summary: string
    tags: string[]
    body: string
}

export interface HelpGroup {
    packageName: string
    pkgSlug: string
    topics: HelpTopic[]
}

export function parseHelpTopicId(id: string): { pkgSlug: string; topicId: string } | null {
    const i = id.indexOf(':')
    if (i <= 0 || i === id.length - 1) return null
    return { pkgSlug: id.slice(0, i), topicId: id.slice(i + 1) }
}
