import { describe, expect, it, vi, beforeEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

vi.mock('node:fs', () => ({
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    readdirSync: vi.fn(),
}))

import {
    findRepoRoot,
    buildWorkspaceVersionMap,
    resolveWorkspaceDependencies,
    stripSemverRanges,
    isExactVersion,
} from '../src/lib/utils/workspace-utils'

describe('CLI utils - workspace-utils', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
    })

    describe('findRepoRoot', () => {
        it('finds workspace root with workspaces array', () => {
            vi.mocked(fs.existsSync).mockImplementation((p) => {
                const str = p.toString().replace(/\\/g, '/')
                return str === '/project/package.json'
            })
            vi.mocked(fs.readFileSync).mockImplementation((p) => {
                const str = p.toString().replace(/\\/g, '/')
                if (str === '/project/package.json') {
                    return JSON.stringify({ workspaces: ['packages/*'] })
                }
                return JSON.stringify({})
            })

            const result = findRepoRoot('/project/packages/pieces/test')
            expect(result).toBe('/project')
        })

        it('throws when no workspace root found', () => {
            vi.mocked(fs.existsSync).mockReturnValue(true)
            vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({}))

            expect(() => findRepoRoot('/project')).toThrow(/no workspace root found/)
        })

        it('traverses up directory tree', () => {
            vi.mocked(fs.existsSync).mockImplementation((p) => {
                const str = p.toString().replace(/\\/g, '/')
                return str.endsWith('package.json')
            })
            vi.mocked(fs.readFileSync).mockImplementation((p) => {
                const str = p.toString().replace(/\\/g, '/')
                if (str.includes('/project/package.json')) {
                    return JSON.stringify({ workspaces: ['packages/*'] })
                }
                return JSON.stringify({})
            })

            const result = findRepoRoot('/project/packages/pieces/test-piece/src')
            expect(result).toBe('/project')
        })
    })

    describe('buildWorkspaceVersionMap', () => {
        it('builds version map from workspace packages', () => {
            vi.mocked(fs.existsSync).mockReturnValue(true)
            vi.mocked(fs.readFileSync).mockImplementation((p) => {
                const str = p.toString().replace(/\\/g, '/')
                if (str.endsWith('package.json') && str.includes('/project/package.json')) {
                    return JSON.stringify({ workspaces: ['packages/*'] })
                }
                if (str.includes('pieces-common/package.json')) {
                    return JSON.stringify({ name: '@inboxfm-connect/pieces-common', version: '1.0.0' })
                }
                if (str.includes('pieces-framework/package.json')) {
                    return JSON.stringify({ name: '@inboxfm-connect/pieces-framework', version: '2.0.0' })
                }
                return JSON.stringify({})
            })
            vi.mocked(fs.readdirSync).mockReturnValue([
                { name: 'pieces-common', isDirectory: () => true },
                { name: 'pieces-framework', isDirectory: () => true },
            ] as unknown as fs.Dirent[])

            const versionMap = buildWorkspaceVersionMap('/project')

            expect(versionMap.get('@inboxfm-connect/pieces-common')).toBe('1.0.0')
            expect(versionMap.get('@inboxfm-connect/pieces-framework')).toBe('2.0.0')
        })
    })

    describe('resolveWorkspaceDependencies', () => {
        it('resolves workspace: dependencies', () => {
            const deps = {
                '@inboxfm-connect/pieces-common': 'workspace:*',
                '@inboxfm-connect/shared': 'workspace:^1.0.0',
                'lodash': '^4.17.0',
            }
            const versionMap = new Map([
                ['@inboxfm-connect/pieces-common', '1.0.0'],
                ['@inboxfm-connect/shared', '2.0.0'],
            ])

            const result = resolveWorkspaceDependencies(deps, versionMap)

            expect(result['@inboxfm-connect/pieces-common']).toBe('1.0.0')
            expect(result['@inboxfm-connect/shared']).toBe('2.0.0')
            expect(result['lodash']).toBe('^4.17.0')
        })

        it('throws when workspace dep not found', () => {
            const deps = { '@inboxfm-connect/missing': 'workspace:*' }
            const versionMap = new Map<string, string>()

            expect(() => resolveWorkspaceDependencies(deps, versionMap))
                .toThrow(/Failed to resolve workspace dependency/)
        })
    })

    describe('isExactVersion', () => {
        it('returns true for exact versions', () => {
            expect(isExactVersion('1.0.0')).toBe(true)
            expect(isExactVersion('2.0.0')).toBe(true)
            expect(isExactVersion('1.0.0-alpha')).toBe(true)
        })

        it('returns false for ranges', () => {
            expect(isExactVersion('^1.0.0')).toBe(false)
            expect(isExactVersion('~1.0.0')).toBe(false)
            expect(isExactVersion('>=1.0.0')).toBe(false)
        })
    })

    describe('stripSemverRanges', () => {
        it('strips caret and tilde prefixes', () => {
            const deps = { 'pkg1': '^1.0.0', 'pkg2': '~2.0.0', 'pkg3': '1.0.0' }
            const result = stripSemverRanges(deps)

            expect(result['pkg1']).toBe('1.0.0')
            expect(result['pkg2']).toBe('2.0.0')
            expect(result['pkg3']).toBe('1.0.0')
        })

        it('throws on unsupported ranges', () => {
            const deps = { 'pkg': '>=1.0.0' }

            expect(() => stripSemverRanges(deps))
                .toThrow(/unsupported version range/)
        })
    })
})
