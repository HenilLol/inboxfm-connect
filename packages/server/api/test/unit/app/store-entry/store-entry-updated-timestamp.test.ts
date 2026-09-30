import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockOrUpdate = vi.fn().mockReturnThis()
const mockExecute = vi.fn().mockResolvedValue({ raw: [] })
const mockValues = vi.fn().mockReturnThis()
const mockInsert = vi.fn().mockReturnThis()

const mockQueryBuilder = {
    insert: mockInsert,
    values: mockValues,
    orUpdate: mockOrUpdate,
    execute: mockExecute,
}

const mockFindOneBy = vi.fn().mockResolvedValue({
    id: 'store_123',
    key: 'test_key',
    value: 'test_value',
    projectId: 'proj_123',
    updated: new Date().toISOString(),
})

vi.mock('../../../../src/app/core/db/repo-factory', () => ({
    repoFactory: vi.fn(() => () => ({
        createQueryBuilder: vi.fn(() => mockQueryBuilder),
        findOneBy: mockFindOneBy,
    })),
}))

import { storeEntryService } from '../../../../src/app/store-entry/store-entry.service'

describe('storeEntryService — Updated Timestamp on Upsert (Issue #323)', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('includes updated column in orUpdate list to ensure updated timestamp is refreshed on conflict', async () => {
        await storeEntryService.upsert({
            projectId: 'proj_123',
            request: {
                key: 'test_key',
                value: 'new_value',
            },
        })

        expect(mockOrUpdate).toHaveBeenCalledWith(
            ['value', 'updated'],
            ['projectId', 'key'],
        )
    })
})
