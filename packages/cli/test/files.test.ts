import { describe, expect, it, vi, beforeEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

vi.mock('node:fs/promises', () => ({
    access: vi.fn(),
    readFile: vi.fn(),
    mkdir: vi.fn(),
}))

import { checkIfFileExists, readPackageJson, makeFolderRecursive, PackageJson } from '../src/lib/utils/files'

describe('CLI utils - files', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
    })

    describe('checkIfFileExists', () => {
        it('returns true when file exists', async () => {
            vi.mocked(fs.access).mockResolvedValue(undefined)
            const result = await checkIfFileExists('/path/to/file')
            expect(result).toBe(true)
            expect(fs.access).toHaveBeenCalledWith('/path/to/file', expect.any(Number))
        })

        it('returns false when file does not exist', async () => {
            vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'))
            const result = await checkIfFileExists('/path/to/missing')
            expect(result).toBe(false)
        })
    })

    describe('readPackageJson', () => {
        it('reads and parses package.json', async () => {
            const mockPkg: PackageJson = { name: 'test-pkg', version: '1.0.0', keywords: ['test'] }
            vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockPkg))

            const result = await readPackageJson('/project/root')
            expect(result).toEqual(mockPkg)
            expect(fs.readFile).toHaveBeenCalledWith('/project/root/package.json', { encoding: 'utf-8' })
        })

        it('throws on invalid JSON', async () => {
            vi.mocked(fs.readFile).mockResolvedValue('invalid json')
            await expect(readPackageJson('/project/root')).rejects.toThrow()
        })
    })

    describe('makeFolderRecursive', () => {
        it('creates directory recursively', async () => {
            vi.mocked(fs.mkdir).mockResolvedValue(undefined)
            await makeFolderRecursive('/deep/nested/path')
            expect(fs.mkdir).toHaveBeenCalledWith('/deep/nested/path', { recursive: true })
        })
    })
})
