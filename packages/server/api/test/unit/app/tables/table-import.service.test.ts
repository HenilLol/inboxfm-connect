import { ActivepiecesError, ErrorCode } from '@inboxfm-connect/core-utils'
import { Field, FieldType, TableImportFormat } from '@inboxfm-connect/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockInsertRecord = vi.fn()
const mockInsertCell = vi.fn()
const mockGetAllFields = vi.fn()
const mockCreateFromState = vi.fn()
const mockValidateCount = vi.fn()

vi.mock('../../../../src/app/core/db/transaction', () => ({
    transaction: async (cb: (em: unknown) => Promise<unknown>) => {
        const mockEm = {
            getRepository: (entity: { options?: { name?: string }, name?: string }) => {
                const name = entity?.options?.name ?? entity?.name
                if (name === 'record') {
                    return { insert: mockInsertRecord }
                }
                if (name === 'cell') {
                    return { insert: mockInsertCell }
                }
                return { insert: vi.fn() }
            },
        }
        return cb(mockEm)
    },
}))

vi.mock('../../../../src/app/tables/field/field.service', () => ({
    fieldService: {
        getAll: (...args: unknown[]) => mockGetAllFields(...args),
        createFromState: (...args: unknown[]) => mockCreateFromState(...args),
    },
}))

vi.mock('../../../../src/app/tables/record/record.service', () => ({
    recordService: {
        validateCount: (...args: unknown[]) => mockValidateCount(...args),
    },
}))

const mockLogger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn(),
} as unknown as import('fastify').FastifyBaseLogger

const { tableImportService } = await import('../../../../src/app/tables/table/table-import.service')

describe('tableImportService (unit)', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockValidateCount.mockResolvedValue(undefined)
        mockInsertRecord.mockResolvedValue({})
        mockInsertCell.mockResolvedValue({})
    })

    describe('CSV Import', () => {
        it('imports standard CSV into existing fields', async () => {
            const existingFields: Field[] = [
                { id: 'f_name', name: 'Name', type: FieldType.TEXT, tableId: 'tbl_1', projectId: 'proj_1', externalId: 'ext_name', position: 0, created: '', updated: '' },
                { id: 'f_age', name: 'Age', type: FieldType.NUMBER, tableId: 'tbl_1', projectId: 'proj_1', externalId: 'ext_age', position: 1, created: '', updated: '' },
            ]
            mockGetAllFields.mockResolvedValue(existingFields)

            const csvData = `Name,Age\nAlice,28\nBob,34`
            const result = await tableImportService.importData({
                projectId: 'proj_1',
                tableId: 'tbl_1',
                request: {
                    format: TableImportFormat.CSV,
                    csvData,
                },
                logger: mockLogger,
            })

            expect(result.totalRows).toBe(2)
            expect(result.importedRecords).toBe(2)
            expect(result.createdFields).toEqual([])
            expect(mockInsertRecord).toHaveBeenCalledTimes(1)
            expect(mockInsertCell).toHaveBeenCalledTimes(1)

            const recordArgs = mockInsertRecord.mock.calls[0][0]
            expect(recordArgs.length).toBe(2)
            expect(recordArgs[0].tableId).toBe('tbl_1')
            expect(recordArgs[0].projectId).toBe('proj_1')

            const cellArgs = mockInsertCell.mock.calls[0][0]
            expect(cellArgs.length).toBe(4)
            expect(cellArgs.find((c: { value: string, fieldId: string }) => c.value === 'Alice')?.fieldId).toBe('f_name')
            expect(cellArgs.find((c: { value: string, fieldId: string }) => c.value === '28')?.fieldId).toBe('f_age')
        })

        it('handles quoted CSV values with commas and escapes', async () => {
            const existingFields: Field[] = [
                { id: 'f_title', name: 'Title', type: FieldType.TEXT, tableId: 'tbl_1', projectId: 'proj_1', externalId: 'ext_title', position: 0, created: '', updated: '' },
                { id: 'f_desc', name: 'Description', type: FieldType.TEXT, tableId: 'tbl_1', projectId: 'proj_1', externalId: 'ext_desc', position: 1, created: '', updated: '' },
            ]
            mockGetAllFields.mockResolvedValue(existingFields)

            const csvData = `Title,Description\n"Hello, World","A quote: ""special"" inside"\n"Second Item","Simple description"`
            const result = await tableImportService.importData({
                projectId: 'proj_1',
                tableId: 'tbl_1',
                request: {
                    format: TableImportFormat.CSV,
                    csvData,
                },
                logger: mockLogger,
            })

            expect(result.totalRows).toBe(2)
            expect(result.importedRecords).toBe(2)

            const cellArgs = mockInsertCell.mock.calls[0][0]
            expect(cellArgs.some((c: { value: string }) => c.value === 'Hello, World')).toBe(true)
            expect(cellArgs.some((c: { value: string }) => c.value === 'A quote: "special" inside')).toBe(true)
        })

        it('throws VALIDATION error for empty csvData', async () => {
            await expect(tableImportService.importData({
                projectId: 'proj_1',
                tableId: 'tbl_1',
                request: {
                    format: TableImportFormat.CSV,
                    csvData: '   ',
                },
                logger: mockLogger,
            })).rejects.toThrowError(ActivepiecesError)
        })

        it('returns zero counts for header-only CSV without inserting', async () => {
            const result = await tableImportService.importData({
                projectId: 'proj_1',
                tableId: 'tbl_1',
                request: {
                    format: TableImportFormat.CSV,
                    csvData: 'Name,Age\n',
                },
                logger: mockLogger,
            })

            expect(result.totalRows).toBe(0)
            expect(result.importedRecords).toBe(0)
            expect(mockInsertRecord).not.toHaveBeenCalled()
        })
    })

    describe('JSON Import', () => {
        it('imports array of JSON objects', async () => {
            const existingFields: Field[] = [
                { id: 'f_product', name: 'Product', type: FieldType.TEXT, tableId: 'tbl_1', projectId: 'proj_1', externalId: 'ext_product', position: 0, created: '', updated: '' },
                { id: 'f_price', name: 'Price', type: FieldType.NUMBER, tableId: 'tbl_1', projectId: 'proj_1', externalId: 'ext_price', position: 1, created: '', updated: '' },
            ]
            mockGetAllFields.mockResolvedValue(existingFields)

            const result = await tableImportService.importData({
                projectId: 'proj_1',
                tableId: 'tbl_1',
                request: {
                    format: TableImportFormat.JSON,
                    jsonData: [
                        { Product: 'Widget A', Price: 19.99 },
                        { Product: 'Widget B', Price: 29.99 },
                    ],
                },
                logger: mockLogger,
            })

            expect(result.totalRows).toBe(2)
            expect(result.importedRecords).toBe(2)
            expect(mockInsertRecord).toHaveBeenCalledTimes(1)
            expect(mockInsertCell).toHaveBeenCalledTimes(1)

            const cellArgs = mockInsertCell.mock.calls[0][0]
            expect(cellArgs.some((c: { value: string, fieldId: string }) => c.value === 'Widget A' && c.fieldId === 'f_product')).toBe(true)
            expect(cellArgs.some((c: { value: string, fieldId: string }) => c.value === '19.99' && c.fieldId === 'f_price')).toBe(true)
        })

        it('throws VALIDATION error for invalid JSON payload', async () => {
            await expect(tableImportService.importData({
                projectId: 'proj_1',
                tableId: 'tbl_1',
                request: {
                    format: TableImportFormat.JSON,
                    jsonData: undefined,
                },
                logger: mockLogger,
            })).rejects.toThrowError(ActivepiecesError)
        })
    })

    describe('Field Matching & Case-Insensitivity', () => {
        it('matches field name case-insensitively', async () => {
            const existingFields: Field[] = [
                { id: 'f_cust_name', name: 'Customer Name', type: FieldType.TEXT, tableId: 'tbl_1', projectId: 'proj_1', externalId: 'ext_1', position: 0, created: '', updated: '' },
            ]
            mockGetAllFields.mockResolvedValue(existingFields)

            const result = await tableImportService.importData({
                projectId: 'proj_1',
                tableId: 'tbl_1',
                request: {
                    format: TableImportFormat.JSON,
                    jsonData: [{ 'customer name': 'John Doe' }],
                },
                logger: mockLogger,
            })

            expect(result.totalRows).toBe(1)
            expect(result.createdFields).toEqual([])
            const cellArgs = mockInsertCell.mock.calls[0][0]
            expect(cellArgs[0].fieldId).toBe('f_cust_name')
            expect(cellArgs[0].value).toBe('John Doe')
        })

        it('matches by externalId if name does not match', async () => {
            const existingFields: Field[] = [
                { id: 'f_target', name: 'Target Field', type: FieldType.TEXT, tableId: 'tbl_1', projectId: 'proj_1', externalId: 'ext_target_col', position: 0, created: '', updated: '' },
            ]
            mockGetAllFields.mockResolvedValue(existingFields)

            const result = await tableImportService.importData({
                projectId: 'proj_1',
                tableId: 'tbl_1',
                request: {
                    format: TableImportFormat.JSON,
                    jsonData: [{ ext_target_col: 'Matched Value' }],
                },
                logger: mockLogger,
            })

            expect(result.totalRows).toBe(1)
            const cellArgs = mockInsertCell.mock.calls[0][0]
            expect(cellArgs[0].fieldId).toBe('f_target')
            expect(cellArgs[0].value).toBe('Matched Value')
        })

        it('rejects unknown column headers when autoCreateFields is false', async () => {
            mockGetAllFields.mockResolvedValue([])

            const promise = tableImportService.importData({
                projectId: 'proj_1',
                tableId: 'tbl_1',
                request: {
                    format: TableImportFormat.JSON,
                    jsonData: [{ UnknownColumn: 'Value' }],
                    autoCreateFields: false,
                },
                logger: mockLogger,
            })
            await expect(promise).rejects.toThrowError(ActivepiecesError)
            try {
                await promise
            }
            catch (e) {
                const apError = e as ActivepiecesError
                expect(apError.error.code).toBe(ErrorCode.VALIDATION)
                expect(apError.error.params?.message).toContain('Unknown column header(s): "UnknownColumn"')
            }
        })
    })

    describe('Auto-Schema Provisioning & Type Inference', () => {
        it('infers NUMBER type for numeric columns', async () => {
            mockGetAllFields.mockResolvedValue([])
            mockCreateFromState.mockImplementation(async ({ field }: { field: { name: string, type: FieldType } }) => ({
                id: `f_${field.name.toLowerCase()}`,
                name: field.name,
                type: field.type,
                tableId: 'tbl_1',
                projectId: 'proj_1',
                externalId: `ext_${field.name}`,
                position: 0,
                created: '',
                updated: '',
            }))

            const result = await tableImportService.importData({
                projectId: 'proj_1',
                tableId: 'tbl_1',
                request: {
                    format: TableImportFormat.JSON,
                    jsonData: [
                        { Score: 100, Balance: -45.5 },
                        { Score: 95, Balance: 120.0 },
                    ],
                    autoCreateFields: true,
                },
                logger: mockLogger,
            })

            expect(result.createdFields.length).toBe(2)
            expect(result.createdFields.find((f) => f.name === 'Score')?.type).toBe(FieldType.NUMBER)
            expect(result.createdFields.find((f) => f.name === 'Balance')?.type).toBe(FieldType.NUMBER)
        })

        it('infers DATE type for ISO date strings', async () => {
            mockGetAllFields.mockResolvedValue([])
            mockCreateFromState.mockImplementation(async ({ field }: { field: { name: string, type: FieldType } }) => ({
                id: `f_${field.name.toLowerCase()}`,
                name: field.name,
                type: field.type,
                tableId: 'tbl_1',
                projectId: 'proj_1',
                externalId: `ext_${field.name}`,
                position: 0,
                created: '',
                updated: '',
            }))

            const result = await tableImportService.importData({
                projectId: 'proj_1',
                tableId: 'tbl_1',
                request: {
                    format: TableImportFormat.JSON,
                    jsonData: [
                        { EventDate: '2026-10-04' },
                        { EventDate: '2026-10-05T14:30:00Z' },
                    ],
                    autoCreateFields: true,
                },
                logger: mockLogger,
            })

            expect(result.createdFields.length).toBe(1)
            expect(result.createdFields[0].name).toBe('EventDate')
            expect(result.createdFields[0].type).toBe(FieldType.DATE)
        })

        it('falls back to TEXT type for mixed or arbitrary string columns', async () => {
            mockGetAllFields.mockResolvedValue([])
            mockCreateFromState.mockImplementation(async ({ field }: { field: { name: string, type: FieldType } }) => ({
                id: `f_${field.name.toLowerCase()}`,
                name: field.name,
                type: field.type,
                tableId: 'tbl_1',
                projectId: 'proj_1',
                externalId: `ext_${field.name}`,
                position: 0,
                created: '',
                updated: '',
            }))

            const result = await tableImportService.importData({
                projectId: 'proj_1',
                tableId: 'tbl_1',
                request: {
                    format: TableImportFormat.JSON,
                    jsonData: [
                        { Notes: 'Order #123' },
                        { Notes: 'Pending shipment' },
                    ],
                    autoCreateFields: true,
                },
                logger: mockLogger,
            })

            expect(result.createdFields.length).toBe(1)
            expect(result.createdFields[0].name).toBe('Notes')
            expect(result.createdFields[0].type).toBe(FieldType.TEXT)
        })
    })

    describe('Limits & Chunking', () => {
        it('rejects import when row count exceeds MAX_IMPORT_ROWS (500)', async () => {
            const rows = Array.from({ length: 501 }, (_, i) => ({ Name: `Person ${i}` }))

            const promise = tableImportService.importData({
                projectId: 'proj_1',
                tableId: 'tbl_1',
                request: {
                    format: TableImportFormat.JSON,
                    jsonData: rows,
                },
                logger: mockLogger,
            })
            await expect(promise).rejects.toThrowError(ActivepiecesError)
            try {
                await promise
            }
            catch (e) {
                const apError = e as ActivepiecesError
                expect(apError.error.code).toBe(ErrorCode.VALIDATION)
                expect(apError.error.params?.message).toContain('Import exceeds maximum allowed rows of 500')
            }
        })

        it('chunks 120 rows into multiple batches of 50 during insertion', async () => {
            const existingFields: Field[] = [
                { id: 'f_idx', name: 'Index', type: FieldType.NUMBER, tableId: 'tbl_1', projectId: 'proj_1', externalId: 'ext_idx', position: 0, created: '', updated: '' },
            ]
            mockGetAllFields.mockResolvedValue(existingFields)

            const rows = Array.from({ length: 120 }, (_, i) => ({ Index: i }))
            const result = await tableImportService.importData({
                projectId: 'proj_1',
                tableId: 'tbl_1',
                request: {
                    format: TableImportFormat.JSON,
                    jsonData: rows,
                },
                logger: mockLogger,
            })

            expect(result.totalRows).toBe(120)
            expect(result.importedRecords).toBe(120)
            expect(mockInsertRecord).toHaveBeenCalledTimes(3) // 50 + 50 + 20
            expect(mockInsertCell).toHaveBeenCalledTimes(3)
        })
    })
})
