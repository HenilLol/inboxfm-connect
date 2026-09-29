import { describe, expect, it, vi, beforeEach } from 'vitest'
import * as fs from 'node:fs'

vi.mock('node:fs', () => ({
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    readdirSync: vi.fn(),
    writeFileSync: vi.fn(),
}))

import { migratePieceUtils, MigratePieceParams } from '../src/lib/utils/migrate-piece-utils'

describe('CLI utils - migrate-piece-utils', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
    })

    describe('migratePiece', () => {
        const mockParams: MigratePieceParams = {
            piecePath: '/pieces/test-piece',
            dryRun: true,
        }

        it('returns report with repointedFiles, manifestChanged, eslintChanged', async () => {
            vi.mocked(fs.existsSync).mockReturnValue(false)
            vi.mocked(fs.readFileSync).mockReturnValue('{}')

            const report = migratePieceUtils.migratePiece(mockParams)

            expect(report).toHaveProperty('repointedFiles')
            expect(report).toHaveProperty('manifestChanged')
            expect(report).toHaveProperty('eslintChanged')
            expect(Array.isArray(report.repointedFiles)).toBe(true)
        })

        it('returns empty repointedFiles when src dir does not exist', async () => {
            vi.mocked(fs.existsSync).mockReturnValue(false)

            const report = migratePieceUtils.migratePiece(mockParams)
            expect(report.repointedFiles).toEqual([])
        })
    })

    describe('repointImports (internal logic)', () => {
        const FRAMEWORK = '@inboxfm-connect/pieces-framework'
        const REPOINTED_MODULES = [
            '@inboxfm-connect/shared',
            '@inboxfm-connect/core-utils',
            '@inboxfm-connect/core-piece-types',
            '@inboxfm-connect/core-formula',
            '@inboxfm-connect/core-execution',
        ]

        function repointImports(content: string): string {
            let next = content
            for (const moduleName of REPOINTED_MODULES) {
                next = next.split(`from '${moduleName}'`).join(`from '${FRAMEWORK}'`)
                next = next.split(`from "${moduleName}"`).join(`from "${FRAMEWORK}"`)
            }
            return next
        }

        it('repoints shared imports to framework', () => {
            const input = "import { something } from '@inboxfm-connect/shared'"
            const output = repointImports(input)
            expect(output).toContain('@inboxfm-connect/pieces-framework')
            expect(output).not.toContain('@inboxfm-connect/shared')
        })

        it('repoints core-utils imports to framework', () => {
            const input = "import { something } from '@inboxfm-connect/core-utils'"
            const output = repointImports(input)
            expect(output).toContain('@inboxfm-connect/pieces-framework')
        })

        it('handles double quotes', () => {
            const input = 'import { something } from "@inboxfm-connect/shared"'
            const output = repointImports(input)
            expect(output).toContain('@inboxfm-connect/pieces-framework')
        })

        it('does not modify unrelated imports', () => {
            const input = "import { something } from 'lodash'"
            const output = repointImports(input)
            expect(output).toBe(input)
        })

        it('handles multiple imports in same file', () => {
            const input = `
import { a } from '@inboxfm-connect/shared'
import { b } from '@inboxfm-connect/core-utils'
import { c } from 'other-package'
            `
            const output = repointImports(input)
            expect(output.split('@inboxfm-connect/pieces-framework').length - 1).toBe(2)
        })
    })
})
