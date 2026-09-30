import { describe, expect, it, vi, beforeEach } from 'vitest'
import * as fs from 'node:fs'

vi.mock('node:fs', () => ({
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    copyFileSync: vi.fn(),
    readdirSync: vi.fn(),
    mkdirSync: vi.fn(),
    statSync: vi.fn(),
    rmSync: vi.fn(),
}))

vi.mock('../src/lib/utils/workspace-utils', () => ({
    findRepoRoot: vi.fn().mockReturnValue('/repo'),
    buildWorkspaceVersionMap: vi.fn().mockReturnValue(new Map()),
    resolveWorkspaceDependencies: vi.fn(),
    stripSemverRanges: vi.fn(),
}))

vi.mock('../src/lib/utils/bundle-piece-utils', () => ({
    bundlePieceUtils: {
        bundlePiece: vi.fn().mockResolvedValue({ bundleBytes: 100, rawBytes: 200, external: [] }),
    },
}))

import { bundlePieceUtils } from '../src/lib/utils/bundle-piece-utils'
import { preparePieceDistForPublish } from '../src/lib/utils/prepare-piece-utils'

describe('CLI utils - prepare-piece-utils', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
    })

    describe('preparePieceDistForPublish', () => {
        it('throws when distPath does not exist', async () => {
            vi.mocked(fs.existsSync).mockReturnValue(false)

            await expect(preparePieceDistForPublish('/pieces/test'))
                .rejects.toThrow(/no dist output/)
        })

        it('calls copyPackageJson and copyI18nAssets', async () => {
            vi.mocked(fs.existsSync).mockReturnValue(true)
            vi.mocked(fs.readFileSync).mockReturnValue('{}')
            vi.mocked(fs.readdirSync).mockReturnValue([])
            vi.mocked(bundlePieceUtils.bundlePiece).mockResolvedValue({ bundleBytes: 100, rawBytes: 200, external: [] })

            await preparePieceDistForPublish('/pieces/test')

            expect(fs.copyFileSync).toHaveBeenCalled()
        })
    })
})
