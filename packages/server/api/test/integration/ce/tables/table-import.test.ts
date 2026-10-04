import { apId } from '@inboxfm-connect/core-utils'
import { FieldType, TableImportFormat } from '@inboxfm-connect/shared'
import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { db } from '../../../helpers/db'
import { describeWithAuth } from '../../../helpers/describe-with-auth'
import {
    createMockField,
    createMockTable,
} from '../../../helpers/mocks'
import { TestContext } from '../../../helpers/test-context'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: FastifyInstance | null = null

beforeAll(async () => {
    app = await setupTestEnvironment()
})

afterAll(async () => {
    await teardownTestEnvironment()
})

describe.skip('Table Import API (Integration)', () => {
    describeWithAuth('POST /v1/tables/:id/import', () => app!, (setup) => {
        it('imports CSV data into existing fields', async () => {
            const ctx = await setup()
            const table = await createAndSaveTable(ctx)
            const nameField = createMockField({ tableId: table.id, projectId: ctx.project.id })
            nameField.name = 'Full Name'
            nameField.type = FieldType.TEXT
            nameField.position = 0
            await db.save('field', nameField)

            const ageField = createMockField({ tableId: table.id, projectId: ctx.project.id })
            ageField.name = 'Age'
            ageField.type = FieldType.NUMBER
            ageField.position = 1
            await db.save('field', ageField)

            const csvData = `Full Name,Age\n"Alice Smith",28\n"Bob Jones",35`

            const response = await ctx.post(`/v1/tables/${table.id}/import`, {
                format: TableImportFormat.CSV,
                csvData,
            })

            expect(response?.statusCode).toBe(StatusCodes.OK)
            const body = response?.json()
            expect(body.totalRows).toBe(2)
            expect(body.importedRecords).toBe(2)
            expect(body.createdFields).toEqual([])

            const records = await db.find('record', { tableId: table.id, projectId: ctx.project.id })
            expect(records.length).toBe(2)

            const cells = await db.find('cell', { projectId: ctx.project.id })
            expect(cells.length).toBe(4)
            expect(cells.some((c: { value: string }) => c.value === 'Alice Smith')).toBe(true)
            expect(cells.some((c: { value: string }) => c.value === '28')).toBe(true)
        })

        it('auto-creates missing fields with inferred types when autoCreateFields is true', async () => {
            const ctx = await setup()
            const table = await createAndSaveTable(ctx)

            const response = await ctx.post(`/v1/tables/${table.id}/import`, {
                format: TableImportFormat.JSON,
                jsonData: [
                    { Title: 'Task A', Priority: 1, CreatedDate: '2026-10-04' },
                    { Title: 'Task B', Priority: 2, CreatedDate: '2026-10-05' },
                ],
                autoCreateFields: true,
            })

            expect(response?.statusCode).toBe(StatusCodes.OK)
            const body = response?.json()
            expect(body.totalRows).toBe(2)
            expect(body.importedRecords).toBe(2)
            expect(body.createdFields.length).toBe(3)

            const titleField = body.createdFields.find((f: { name: string }) => f.name === 'Title')
            expect(titleField?.type).toBe(FieldType.TEXT)

            const priorityField = body.createdFields.find((f: { name: string }) => f.name === 'Priority')
            expect(priorityField?.type).toBe(FieldType.NUMBER)

            const dateField = body.createdFields.find((f: { name: string }) => f.name === 'CreatedDate')
            expect(dateField?.type).toBe(FieldType.DATE)
        })

        it('rejects unknown column headers when autoCreateFields is false', async () => {
            const ctx = await setup()
            const table = await createAndSaveTable(ctx)

            const response = await ctx.post(`/v1/tables/${table.id}/import`, {
                format: TableImportFormat.JSON,
                jsonData: [
                    { UnknownField: 'Some value' },
                ],
                autoCreateFields: false,
            })

            expect(response?.statusCode).toBe(StatusCodes.BAD_REQUEST)
            const body = response?.json()
            expect(body.code).toBe('VALIDATION')
        })

        it('rejects cross-project table import attempt', async () => {
            const ctx = await setup()
            const otherProjectId = apId()
            const otherTable = createMockTable({ projectId: otherProjectId })
            await db.save('table', otherTable)

            const response = await ctx.post(`/v1/tables/${otherTable.id}/import`, {
                format: TableImportFormat.JSON,
                jsonData: [{ Name: 'Test' }],
            })

            expect(response?.statusCode).toBe(StatusCodes.NOT_FOUND)
        })
    })
})

async function createAndSaveTable(ctx: TestContext) {
    const table = createMockTable({ projectId: ctx.project.id })
    await db.save('table', table)
    return table
}
