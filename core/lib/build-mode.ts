import { getCoreConfigOptional } from './core-config'

export type BuildMode = 'production' | 'review'

export function getBuildMode(): BuildMode {
    return getCoreConfigOptional()?.reviewMode ? 'review' : 'production'
}

export function isReviewBuild(): boolean {
    return getBuildMode() === 'review'
}
