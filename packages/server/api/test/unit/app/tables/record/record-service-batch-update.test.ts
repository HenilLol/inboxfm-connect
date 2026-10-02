import { ActivepiecesError, ErrorCode } from '@inboxfm-connect/core-utils'
import { BatchUpdateRecordsRequest } from '@inboxfm-connect/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockEmFind = vi.fn()
const mockEmUpsert = vi.fn()
const mockEmGetRepository = vi.fn((entity: { name?: string }) => {
    return {
        find: mockEmFind,
        upsert: mockEmUpsert,
    }
})

const mockEntityManager = {
    getRepository: mockEmGetRepository,
}

vi.mock('../../../../../src/app/core/db/repo-factory', () => ({
    repoFactory: () => () => ({
        findOne: vi.fn(),
        find: vi.fn(),
        delete: vi.fn(),
    }),
}))

vi.mock('../../../../../src/app/core/db/transaction', () => ({
    transaction: async <T>(fn: (em: typeof mockEntityManager) => Promise<T>): Promise<T> => fn(mockEntityManager),
}))

vi.mock('../../../../../src/app/tables/field/field.service', () => ({
    fieldService: {
        getAll: vi.fn(async () => []),
        getAllByTableIds: vi.fn(async () => new Map()),
    },
}))

beforeEach(() => {
    vi.clearAllMocks()
})

const { recordService } = await import('../../../../../src/app/tables/record/record.service')

describe('BatchUpdateRecordsRequest DTO schema validation', () => {
    it('accepts a valid batch update request', () => {
        const payload = {
            tableId: 'table_123',
            records: [
                {
                    id: 'rec_1',
                    cells: [
                        { fieldId: 'field_1', value: 'hello' },
                    ],
                },
                {
                    id: 'rec_2',
                    cells: [
                        { fieldId: 'field_2', value: 42 },
                    ],
                },
            ],
            agentUpdate: false,
        }

        const parsed = BatchUpdateRecordsRequest.safeParse(payload)
        expect(parsed.success).toBe(true)
        if (parsed.success) {
            expect(parsed.data.records).toHaveLength(2)
            expect(parsed.data.records[1].cells[0].value).toBe('42')
        }
    })

    it('rejects batch when records array is empty', () => {
        const payload = {
            tableId: 'table_123',
            records: [],
        }

        const parsed = BatchUpdateRecordsRequest.safeParse(payload)
        expect(parsed.success).toBe(false)
    })

    it('rejects batch exceeding 50 records', () => {
        const records = Array.from({ length: 51 }, (_, i) => ({
            id: `rec_${i}`,
            cells: [{ fieldId: 'field_1', value: `val_${i}` }],
        }))

        const payload = {
            tableId: 'table_123',
            records,
        }

        const parsed = BatchUpdateRecordsRequest.safeParse(payload)
        expect(parsed.success).toBe(false)
    })

    it('rejects batch with duplicate record IDs', () => {
        const payload = {
            tableId: 'table_123',
            records: [
                { id: 'rec_dup', cells: [{ fieldId: 'f1', value: 'a' }] },
                { id: 'rec_dup', cells: [{ fieldId: 'f1', value: 'b' }] },
            ],
        }

        const parsed = BatchUpdateRecordsRequest.safeParse(payload)
        expect(parsed.success).toBe(false)
        if (!parsed.success) {
            expect(parsed.error.issues[0].message).toContain('Duplicate record IDs')
        }
    })
})

describe('recordService.batchUpdate (unit)', () => {
    const projectId = 'proj_123'
    const tableId = 'table_123'

    it('returns empty array immediately when records array is empty', async () => {
        const result = await recordService.batchUpdate({
            projectId,
            request: {
                tableId,
                records: [],
            },
        })

        expect(result).toEqual([])
        expect(mockEmFind).not.toHaveBeenCalled()
    })

    it('rejects duplicate record IDs at service level', async () => {
        await expect(
            recordService.batchUpdate({
                projectId,
                request: {
                    tableId,
                    records: [
                        { id: 'rec_dup', cells: [{ fieldId: 'f1', value: 'a' }] },
                        { id: 'rec_dup', cells: [{ fieldId: 'f1', value: 'b' }] },
                    ],
                },
            }),
        ).rejects.toThrow(ActivepiecesError)
    })

    it('throws ENTITY_NOT_FOUND when one of the requested record IDs does not exist in table/project', async () => {
        // mock finding only 1 of the 2 requested records
        mockEmFind.mockResolvedValueOnce([
            { id: 'rec_1', tableId, projectId, cells: [] },
        ])

        await expect(
            recordService.batchUpdate({
                projectId,
                request: {
                    tableId,
                    records: [
                        { id: 'rec_1', cells: [{ fieldId: 'f1', value: 'v1' }] },
                        { id: 'rec_missing_2', cells: [{ fieldId: 'f1', value: 'v2' }] },
                    ],
                },
            }),
        ).rejects.toMatchObject({
            error: {
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: {
                    entityType: 'Record',
                    entityId: 'rec_missing_2',
                },
            },
        })

        // Upsert must NOT be called on failure
        expect(mockEmUpsert).not.toHaveBeenCalled()
    })

    it('throws ENTITY_NOT_FOUND when record belongs to a different table or project (isolation check)', async () => {
        // entityManager find returns empty because where clause filters on tableId & projectId
        mockEmFind.mockResolvedValueOnce([])

        await expect(
            recordService.batchUpdate({
                projectId,
                request: {
                    tableId: 'table_A',
                    records: [
                        { id: 'rec_from_table_B', cells: [{ fieldId: 'f1', value: 'v1' }] },
                    ],
                },
            }),
        ).rejects.toMatchObject({
            error: {
                code: ErrorCode.ENTITY_NOT_FOUND,
            },
        })

        expect(mockEmUpsert).not.toHaveBeenCalled()
    })

    it('successfully updates multiple records and cells atomically, formatting and returning updated records', async () => {
        const fields = [
            { id: 'field_name', name: 'Name', tableId, projectId },
            { id: 'field_email', name: 'Email', tableId, projectId },
        ]

        // 1. First find: existing records check
        mockEmFind.mockResolvedValueOnce([
            { id: 'rec_1', tableId, projectId, created: '2026-01-01', updated: '2026-01-01' },
            { id: 'rec_2', tableId, projectId, created: '2026-01-01', updated: '2026-01-01' },
        ])

        // 2. Second find: existing fields lookup
        mockEmFind.mockResolvedValueOnce(fields)

        // 3. Upsert cells: success
        mockEmUpsert.mockResolvedValueOnce(undefined)

        // 4. Third find: fetch updated records with relations
        mockEmFind.mockResolvedValueOnce([
            {
                id: 'rec_1',
                tableId,
                projectId,
                created: '2026-01-01',
                updated: '2026-01-02',
                cells: [
                    { id: 'c1', recordId: 'rec_1', fieldId: 'field_name', value: 'Alice', created: '2026-01-01', updated: '2026-01-02' },
                    { id: 'c2', recordId: 'rec_1', fieldId: 'field_email', value: 'alice@example.com', created: '2026-01-01', updated: '2026-01-02' },
                ],
            },
            {
                id: 'rec_2',
                tableId,
                projectId,
                created: '2026-01-01',
                updated: '2026-01-02',
                cells: [
                    { id: 'c3', recordId: 'rec_2', fieldId: 'field_name', value: 'Bob', created: '2026-01-01', updated: '2026-01-02' },
                ],
            },
        ])

        const result = await recordService.batchUpdate({
            projectId,
            request: {
                tableId,
                records: [
                    {
                        id: 'rec_1',
                        cells: [
                            { fieldId: 'field_name', value: 'Alice' },
                            { fieldId: 'field_email', value: 'alice@example.com' },
                        ],
                    },
                    {
                        id: 'rec_2',
                        cells: [
                            { fieldId: 'field_name', value: 'Bob' },
                            { fieldId: 'field_nonexistent', value: 'ignore_me' },
                        ],
                    },
                ],
            },
        })

        // Verify cell upserts occurred
        expect(mockEmUpsert).toHaveBeenCalledTimes(1)
        const [upsertedCells, conflictTargets] = mockEmUpsert.mock.calls[0]
        expect(conflictTargets).toEqual(['projectId', 'fieldId', 'recordId'])
        // Nonexistent field cell must be filtered out; valid cells must be 3
        expect(upsertedCells).toHaveLength(3)
        expect(upsertedCells).toEqual([
            expect.objectContaining({ recordId: 'rec_1', fieldId: 'field_name', value: 'Alice' }),
            expect.objectContaining({ recordId: 'rec_1', fieldId: 'field_email', value: 'alice@example.com' }),
            expect.objectContaining({ recordId: 'rec_2', fieldId: 'field_name', value: 'Bob' }),
        ])

        // Verify formatted result
        expect(result).toHaveLength(2)
        expect(result[0].id).toBe('rec_1')
        expect(result[0].cells['field_name'].value).toBe('Alice')
        expect(result[0].cells['field_email'].value).toBe('alice@example.com')
        expect(result[1].id).toBe('rec_2')
        expect(result[1].cells['field_name'].value).toBe('Bob')
        expect(result[1].cells['field_email'].value).toBeNull() // unassigned field filled with null
    })

    it('preserves the order of requested records in the returned array', async () => {
        const fields = [{ id: 'f1', name: 'Field 1', tableId, projectId }]

        mockEmFind.mockResolvedValueOnce([
            { id: 'rec_B', tableId, projectId, created: '2026-01-02', updated: '2026-01-02' },
            { id: 'rec_A', tableId, projectId, created: '2026-01-01', updated: '2026-01-01' },
        ])
        mockEmFind.mockResolvedValueOnce(fields)
        mockEmUpsert.mockResolvedValueOnce(undefined)
        // Simulate DB returning records in arbitrary order (e.g. rec_A first)
        mockEmFind.mockResolvedValueOnce([
            { id: 'rec_A', tableId, projectId, created: '2026-01-01', updated: '2026-01-01', cells: [] },
            { id: 'rec_B', tableId, projectId, created: '2026-01-02', updated: '2026-01-02', cells: [] },
        ])

        // Request order is rec_B, rec_A
        const result = await recordService.batchUpdate({
            projectId,
            request: {
                tableId,
                records: [
                    { id: 'rec_B', cells: [{ fieldId: 'f1', value: 'B' }] },
                    { id: 'rec_A', cells: [{ fieldId: 'f1', value: 'A' }] },
                ],
            },
        })

        expect(result.map((r) => r.id)).toEqual(['rec_B', 'rec_A'])
    })
})

describe('recordSideEffects with batch update', () => {
    it('dispatches updated webhook event for every record in the batch', async () => {
        const triggerWebhooksSpy = vi.spyOn(recordService, 'triggerWebhooks').mockResolvedValue(undefined)
        const { recordSideEffects } = await import('../../../../../src/app/tables/record/record-side-effects')

        const mockLogger = { info: vi.fn(), error: vi.fn() } as unknown as import('fastify').FastifyBaseLogger
        const sideEffects = recordSideEffects(mockLogger)

        const records = [
            { id: 'rec_1', tableId: 'table_1', projectId: 'proj_1', cells: {}, created: '', updated: '' },
            { id: 'rec_2', tableId: 'table_1', projectId: 'proj_1', cells: {}, created: '', updated: '' },
        ]

        await sideEffects.handleRecordsEvent({
            projectId: 'proj_1',
            tableId: 'table_1',
            records,
            logger: mockLogger,
            authorization: 'Bearer token',
            agentUpdate: false,
        }, 'updated')

        expect(triggerWebhooksSpy).toHaveBeenCalledTimes(2)
        expect(triggerWebhooksSpy).toHaveBeenNthCalledWith(1, expect.objectContaining({
            projectId: 'proj_1',
            tableId: 'table_1',
            eventType: 'RECORD_UPDATED',
            data: { record: records[0] },
        }))
        expect(triggerWebhooksSpy).toHaveBeenNthCalledWith(2, expect.objectContaining({
            projectId: 'proj_1',
            tableId: 'table_1',
            eventType: 'RECORD_UPDATED',
            data: { record: records[1] },
        }))
    })
})
