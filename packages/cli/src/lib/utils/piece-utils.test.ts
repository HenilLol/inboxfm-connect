import { describe, expect, it } from 'vitest'
import * as path from 'path'
import { piecesPath, customPiecePath, findPieces, findPiece } from './piece-utils'
import { findRepoRoot } from './workspace-utils'

describe('piece-utils paths and discovery', () => {
    const root = findRepoRoot(process.cwd())

    it('points piecesPath to packages/integrations', () => {
        const p = piecesPath()
        expect(p).toBe(path.join(root, 'packages', 'integrations'))
    })

    it('points customPiecePath to packages/integrations/custom', () => {
        const cp = customPiecePath()
        expect(cp).toBe(path.join(root, 'packages', 'integrations', 'custom'))
    })

    it('finds existing integration pieces under packages/integrations', async () => {
        const pieces = await findPieces(piecesPath())
        expect(pieces.length).toBeGreaterThan(0)

        // Negative assertion: framework and common foundation packages must not be returned
        expect(pieces.some((p) => /[\\/]framework|[\\/]common$/.test(p))).toBe(false)

        // Pin known pieces to guarantee real integration pieces are discovered
        expect(pieces.some((p) => p.endsWith('slack') || p.endsWith('http'))).toBe(true)
    })

    it('findPiece discovers existing pieces by name', async () => {
        const piece = await findPiece('http')
        expect(piece).not.toBeNull()
        expect(piece?.endsWith(path.join('integrations', 'core', 'http'))).toBe(true)
    })

    it('findPiece does not resolve foundation packages', async () => {
        const framework = await findPiece('framework')
        expect(framework).toBeNull()

        const common = await findPiece('common')
        expect(common).toBeNull()
    })

    it('findPieces returns empty list when pointed directly at foundation packages', async () => {
        const frameworkPieces = await findPieces(path.join(piecesPath(), 'framework'))
        expect(frameworkPieces).toEqual([])

        const commonPieces = await findPieces(path.join(piecesPath(), 'common'))
        expect(commonPieces).toEqual([])
    })
})
