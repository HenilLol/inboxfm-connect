import { describe, expect, it } from 'vitest'

// Issue #417: lastVersionOfEachPiece must dedupe by (name, platformId) scope,
// not by name alone — a platform-scoped custom piece sharing a name with an
// official piece must BOTH survive. Mirrors pickLatestVersionIds' key shape.

type PieceLike = {
    name: string
    version: string
    platformId?: string
}

const loadFn = async () => {
    const mod = await import('../../../../../../src/app/pieces/metadata/utils/piece-cache-utils')
    return mod.lastVersionOfEachPiece as (pieces: PieceLike[]) => PieceLike[]
}

describe('lastVersionOfEachPiece — scope-aware dedupe (issue #417)', () => {
    it('keeps BOTH the official piece and the platform-scoped custom piece when names collide', async () => {
        const lastVersionOfEachPiece = await loadFn()
        const official: PieceLike = { name: 'slack', version: '2.3.1' }
        const custom: PieceLike = { name: 'slack', version: '1.0.0', platformId: 'acme' }
        const result = lastVersionOfEachPiece([official, custom])
        expect(result).toHaveLength(2)
        expect(result.some((p) => p.platformId === undefined && p.version === '2.3.1')).toBe(true)
        expect(result.some((p) => p.platformId === 'acme' && p.version === '1.0.0')).toBe(true)
    })

    it('still dedupes same-scope duplicates, keeping the newest version', async () => {
        const lastVersionOfEachPiece = await loadFn()
        const result = lastVersionOfEachPiece([
            { name: 'slack', version: '1.0.0' },
            { name: 'slack', version: '2.0.0' },
            { name: 'slack', version: '1.5.0' },
        ])
        expect(result).toHaveLength(1)
        expect(result[0].version).toBe('2.0.0')
    })

    it('keeps the platform piece across TWO different platforms with the same name', async () => {
        const lastVersionOfEachPiece = await loadFn()
        const result = lastVersionOfEachPiece([
            { name: 'slack', version: '3.0.0', platformId: 'alpha' },
            { name: 'slack', version: '1.0.0', platformId: 'beta' },
        ])
        expect(result).toHaveLength(2)
    })
})
