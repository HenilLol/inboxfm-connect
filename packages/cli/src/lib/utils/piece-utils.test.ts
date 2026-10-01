import { describe, expect, it } from 'vitest'
import * as path from 'path'
import { piecesPath, customPiecePath, findPieces } from './piece-utils'

describe('piece-utils paths and discovery', () => {
    it('points piecesPath to packages/integrations', () => {
        const p = piecesPath()
        expect(p).toBe(path.join(process.cwd(), 'packages', 'integrations'))
    })

    it('points customPiecePath to packages/integrations/custom', () => {
        const cp = customPiecePath()
        expect(cp).toBe(path.join(process.cwd(), 'packages', 'integrations', 'custom'))
    })

    it('finds existing integration pieces under packages/integrations', async () => {
        const pieces = await findPieces(piecesPath())
        expect(pieces.length).toBeGreaterThan(0)
    })
})
