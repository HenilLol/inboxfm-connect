import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockFindOne = vi.fn()
const mockFind = vi.fn()
const mockDelete = vi.fn()

vi.mock('../../../../../src/app/core/db/repo-factory', () => ({
    repoFactory: () => () => ({
        findOne: mockFindOne,
        find: mockFind,
        delete: mockDelete,
    }),
}))

vi.mock('../../../../../src/app/tables/field/field.service', () => ({
    fieldService: {
        getAllByTableIds: vi.fn(async () => new Map()),
        getAll: vi.fn(async () => []),
    },
}))

beforeEach(() => {
    vi.clearAllMocks()
})

const { recordService } = await import('../../../../../src/app/tables/record/record.service')

describe('recordService.delete (unit)', () => {
    it('returns an empty array immediately when ids array is empty without querying the repository', async () => {
        const result = await recordService.delete({ ids: [], projectId: 'proj_123' })
        expect(result).toEqual([])
        expect(mockFindOne).not.toHaveBeenCalled()
        expect(mockFind).not.toHaveBeenCalled()
        expect(mockDelete).not.toHaveBeenCalled()
    })

    it('returns an empty array immediately when ids is undefined or null', async () => {
        // @ts-expect-error testing defensive check against invalid caller data
        const result = await recordService.delete({ ids: undefined, projectId: 'proj_123' })
        expect(result).toEqual([])
        expect(mockFindOne).not.toHaveBeenCalled()
        expect(mockFind).not.toHaveBeenCalled()
        expect(mockDelete).not.toHaveBeenCalled()
    })
})

describe('recordService.delete cross-table scoping (issue: delete pins the batch to ids[0] table)', () => {
    it('deletes every requested id across mixed tables instead of dropping rows from other tables', async () => {
        // ids[0] belongs to tableA, ids[1] belongs to tableB (same project).
        // The service resolves tableId from ids[0] and filters BOTH the find and
        // the delete on that single table - so the tableB row is silently dropped
        // even though the caller asked for its deletion and gets a success shape.
        mockFindOne.mockResolvedValueOnce({ id: 'rec_A1', tableId: 'tableA' })
        mockFind.mockImplementationOnce(async (criteria: { where: { id: { value: string[] } } }) => {
            const wanted = criteria.where.id.value
            const all = [
                { id: 'rec_A1', tableId: 'tableA', cells: [] },
                { id: 'rec_B1', tableId: 'tableB', cells: [] },
            ]
            return all.filter((r) => wanted.includes(r.id))
        })
        mockDelete.mockResolvedValueOnce({ affected: 2 })

        const result = await recordService.delete({
            ids: ['rec_A1', 'rec_B1'],
            projectId: 'proj_123',
        })

        // Every requested id must be deleted: currently the tableB row survives
        // because the find/delete filter on ids[0]'s table only.
        const deletedScopes = mockDelete.mock.calls.map((call) => call[0])
        expect(deletedScopes).toContainEqual(expect.objectContaining({ tableId: 'tableB' }))
        expect(deletedScopes).toContainEqual(expect.objectContaining({ tableId: 'tableA' }))
        expect(result).toHaveLength(2)
    })

    it('honors the declared tableId when the caller supplies one (REST DeleteRecordsRequest carries tableId)', async () => {
        mockFindOne.mockResolvedValueOnce({ id: 'rec_A1', tableId: 'tableA' })
        mockFind.mockImplementationOnce(async () => [{ id: 'rec_A1', tableId: 'tableA', cells: [] }])

        await recordService.delete({
            ids: ['rec_A1'],
            projectId: 'proj_123',
            tableId: 'tableA',
        })

        // The declared tableId must be the scoping key, not ids[0]'s resolved table
        expect(mockDelete).toHaveBeenCalledWith(
            expect.objectContaining({ tableId: 'tableA' }),
        )
    })
})
