import { describe, expect, it, vi } from 'vitest'
import { runAll } from '../src/orchestrator'

describe('runAll', () => {
    it('aggregates: runs every target even when one fails, returns non-zero', async () => {
        const targets = ['a', 'b', 'c']
        const run = vi.fn(async (slug: string) => (slug === 'b' ? 1 : 0))
        const result = await runAll(targets, run, { bail: false })
        expect(run).toHaveBeenCalledTimes(3)
        expect(result.exitCode).not.toBe(0)
        expect(result.results).toEqual([
            { target: 'a', code: 0 },
            { target: 'b', code: 1 },
            { target: 'c', code: 0 },
        ])
    })

    it('--bail stops at the first failure', async () => {
        const run = vi.fn(async (slug: string) => (slug === 'a' ? 1 : 0))
        const result = await runAll(['a', 'b', 'c'], run, { bail: true })
        expect(run).toHaveBeenCalledTimes(1)
        expect(result.exitCode).not.toBe(0)
    })
})
