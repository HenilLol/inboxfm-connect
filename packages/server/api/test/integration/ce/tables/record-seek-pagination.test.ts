import { apId } from '@inboxfm-connect/core-utils'
import { FieldType, FilterOperator } from '@inboxfm-connect/shared'
import { FastifyInstance } from 'fastify'
import { db } from '../../../helpers/db'
import { createTestContext } from '../../../helpers/test-context'
import {
    createMockCell,
    createMockField,
    createMockRecord,
    createMockTable,
} from '../../../helpers/mocks'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'
import { recordService } from '../../../../src/app/tables/record/record.service'

let app: FastifyInstance | null = null

beforeAll(async () => {
    app = await setupTestEnvironment()
})

afterAll(async () => {
    await teardownTestEnvironment()
})

describe('Record Service - SQL Seek Pagination and Filtering (#157)', () => {
    async function setupTableWithField() {
        const ctx = await createTestContext(app!)

        const table = createMockTable({ projectId: ctx.project.id })
        await db.save('table', table)

        const field = createMockField({ tableId: table.id, projectId: ctx.project.id, position: 0 })
        field.type = FieldType.TEXT
        field.name = 'status'
        await db.save('field', field)

        const numField = createMockField({ tableId: table.id, projectId: ctx.project.id, position: 1 })
        numField.type = FieldType.NUMBER
        numField.name = 'score'
        await db.save('field', numField)

        return { project: ctx.project, table, field, numField }
    }

    it('should paginate records using seek cursors (next and previous)', async () => {
        const { project, table, field } = await setupTableWithField()
        const baseTime = Date.now() - 100000

        const records = []
        for (let i = 0; i < 5; i++) {
            const rec = createMockRecord({ tableId: table.id, projectId: project.id })
            rec.created = new Date(baseTime + i * 1000).toISOString()
            await db.save('record', rec)
            records.push(rec)

            const cell = createMockCell({ recordId: rec.id, fieldId: field.id, projectId: project.id })
            cell.value = `row-${i}`
            await db.save('cell', cell)
        }

        // Page 1: limit 2
        const page1 = await recordService.list({
            tableId: table.id,
            projectId: project.id,
            cursorRequest: null,
            limit: 2,
            filters: null,
        })

        expect(page1.data).toHaveLength(2)
        expect(page1.data[0].id).toBe(records[0].id)
        expect(page1.data[1].id).toBe(records[1].id)
        expect(page1.next).not.toBeNull()
        expect(page1.previous).toBeNull()

        // Page 2: after page1.next
        const page2 = await recordService.list({
            tableId: table.id,
            projectId: project.id,
            cursorRequest: page1.next,
            limit: 2,
            filters: null,
        })

        expect(page2.data).toHaveLength(2)
        expect(page2.data[0].id).toBe(records[2].id)
        expect(page2.data[1].id).toBe(records[3].id)
        expect(page2.next).not.toBeNull()
        expect(page2.previous).not.toBeNull()

        // Page 3: after page2.next
        const page3 = await recordService.list({
            tableId: table.id,
            projectId: project.id,
            cursorRequest: page2.next,
            limit: 2,
            filters: null,
        })

        expect(page3.data).toHaveLength(1)
        expect(page3.data[0].id).toBe(records[4].id)
        expect(page3.next).toBeNull()
        expect(page3.previous).not.toBeNull()

        // Navigate backwards from page 2 using beforeCursor
        const prevPage = await recordService.list({
            tableId: table.id,
            projectId: project.id,
            cursorRequest: page2.previous,
            limit: 2,
            filters: null,
        })

        expect(prevPage.data).toHaveLength(2)
        expect(prevPage.data[0].id).toBe(records[0].id)
        expect(prevPage.data[1].id).toBe(records[1].id)
    })

    it('should evaluate EXISTS and NOT_EXISTS in SQL', async () => {
        const { project, table, field } = await setupTableWithField()
        const rec1 = createMockRecord({ tableId: table.id, projectId: project.id })
        const rec2 = createMockRecord({ tableId: table.id, projectId: project.id })
        const rec3 = createMockRecord({ tableId: table.id, projectId: project.id })
        await db.save('record', [rec1, rec2, rec3])

        // rec1 has non-empty cell
        const cell1 = createMockCell({ recordId: rec1.id, fieldId: field.id, projectId: project.id })
        cell1.value = 'present'
        await db.save('cell', cell1)

        // rec2 has empty cell
        const cell2 = createMockCell({ recordId: rec2.id, fieldId: field.id, projectId: project.id })
        cell2.value = ''
        await db.save('cell', cell2)

        // rec3 has no cell

        const existsResult = await recordService.list({
            tableId: table.id,
            projectId: project.id,
            cursorRequest: null,
            limit: 10,
            filters: [{ fieldId: field.id, operator: FilterOperator.EXISTS }],
        })
        expect(existsResult.data).toHaveLength(1)
        expect(existsResult.data[0].id).toBe(rec1.id)

        const notExistsResult = await recordService.list({
            tableId: table.id,
            projectId: project.id,
            cursorRequest: null,
            limit: 10,
            filters: [{ fieldId: field.id, operator: FilterOperator.NOT_EXISTS }],
        })
        const notExistsIds = notExistsResult.data.map((r) => r.id)
        expect(notExistsIds).toContain(rec2.id)
        expect(notExistsIds).toContain(rec3.id)
        expect(notExistsIds).not.toContain(rec1.id)
    })

    it('should evaluate EQ and NEQ in SQL', async () => {
        const { project, table, field } = await setupTableWithField()
        const rec1 = createMockRecord({ tableId: table.id, projectId: project.id })
        const rec2 = createMockRecord({ tableId: table.id, projectId: project.id })
        const rec3 = createMockRecord({ tableId: table.id, projectId: project.id })
        await db.save('record', [rec1, rec2, rec3])

        const cell1 = createMockCell({ recordId: rec1.id, fieldId: field.id, projectId: project.id })
        cell1.value = 'active'
        const cell2 = createMockCell({ recordId: rec2.id, fieldId: field.id, projectId: project.id })
        cell2.value = 'inactive'
        await db.save('cell', [cell1, cell2])

        // rec3 has no cell (treated as '')

        const eqResult = await recordService.list({
            tableId: table.id,
            projectId: project.id,
            cursorRequest: null,
            limit: 10,
            filters: [{ fieldId: field.id, operator: FilterOperator.EQ, value: 'active' }],
        })
        expect(eqResult.data).toHaveLength(1)
        expect(eqResult.data[0].id).toBe(rec1.id)

        const neqResult = await recordService.list({
            tableId: table.id,
            projectId: project.id,
            cursorRequest: null,
            limit: 10,
            filters: [{ fieldId: field.id, operator: FilterOperator.NEQ, value: 'active' }],
        })
        const neqIds = neqResult.data.map((r) => r.id)
        expect(neqIds).toContain(rec2.id)
        expect(neqIds).toContain(rec3.id)
        expect(neqIds).not.toContain(rec1.id)
    })

    it('should evaluate CO (contains) in SQL', async () => {
        const { project, table, field } = await setupTableWithField()
        const rec1 = createMockRecord({ tableId: table.id, projectId: project.id })
        const rec2 = createMockRecord({ tableId: table.id, projectId: project.id })
        await db.save('record', [rec1, rec2])

        const cell1 = createMockCell({ recordId: rec1.id, fieldId: field.id, projectId: project.id })
        cell1.value = 'Hello World'
        const cell2 = createMockCell({ recordId: rec2.id, fieldId: field.id, projectId: project.id })
        cell2.value = 'Goodbye Universe'
        await db.save('cell', [cell1, cell2])

        const coResult = await recordService.list({
            tableId: table.id,
            projectId: project.id,
            cursorRequest: null,
            limit: 10,
            filters: [{ fieldId: field.id, operator: FilterOperator.CO, value: 'world' }],
        })
        expect(coResult.data).toHaveLength(1)
        expect(coResult.data[0].id).toBe(rec1.id)
    })

    it('should evaluate numeric comparisons (GT, GTE, LT, LTE) safely in SQL', async () => {
        const { project, table, numField } = await setupTableWithField()
        const rec1 = createMockRecord({ tableId: table.id, projectId: project.id })
        const rec2 = createMockRecord({ tableId: table.id, projectId: project.id })
        const rec3 = createMockRecord({ tableId: table.id, projectId: project.id })
        const recText = createMockRecord({ tableId: table.id, projectId: project.id })
        await db.save('record', [rec1, rec2, rec3, recText])

        const cell1 = createMockCell({ recordId: rec1.id, fieldId: numField.id, projectId: project.id })
        cell1.value = '10'
        const cell2 = createMockCell({ recordId: rec2.id, fieldId: numField.id, projectId: project.id })
        cell2.value = '25.5'
        const cell3 = createMockCell({ recordId: rec3.id, fieldId: numField.id, projectId: project.id })
        cell3.value = '50'
        const cellText = createMockCell({ recordId: recText.id, fieldId: numField.id, projectId: project.id })
        cellText.value = 'not-a-number'
        await db.save('cell', [cell1, cell2, cell3, cellText])

        // GT: > 20
        const gtResult = await recordService.list({
            tableId: table.id,
            projectId: project.id,
            cursorRequest: null,
            limit: 10,
            filters: [{ fieldId: numField.id, operator: FilterOperator.GT, value: '20' }],
        })
        const gtIds = gtResult.data.map((r) => r.id)
        expect(gtIds).toHaveLength(2)
        expect(gtIds).toContain(rec2.id)
        expect(gtIds).toContain(rec3.id)
        expect(gtIds).not.toContain(rec1.id)
        expect(gtIds).not.toContain(recText.id)

        // LTE: <= 25.5
        const lteResult = await recordService.list({
            tableId: table.id,
            projectId: project.id,
            cursorRequest: null,
            limit: 10,
            filters: [{ fieldId: numField.id, operator: FilterOperator.LTE, value: '25.5' }],
        })
        const lteIds = lteResult.data.map((r) => r.id)
        expect(lteIds).toHaveLength(2)
        expect(lteIds).toContain(rec1.id)
        expect(lteIds).toContain(rec2.id)
        expect(lteIds).not.toContain(rec3.id)
    })

    it('should return empty page for empty table', async () => {
        const { project, table } = await setupTableWithField()

        const result = await recordService.list({
            tableId: table.id,
            projectId: project.id,
            cursorRequest: null,
            limit: 10,
            filters: null,
        })

        expect(result.data).toEqual([])
        expect(result.next).toBeNull()
        expect(result.previous).toBeNull()
    })

    it('should only fetch and populate cells for records on the returned page', async () => {
        const { project, table, field } = await setupTableWithField()

        for (let i = 0; i < 10; i++) {
            const rec = createMockRecord({ tableId: table.id, projectId: project.id })
            await db.save('record', rec)
            const cell = createMockCell({ recordId: rec.id, fieldId: field.id, projectId: project.id })
            cell.value = `val-${i}`
            await db.save('cell', cell)
        }

        const page = await recordService.list({
            tableId: table.id,
            projectId: project.id,
            cursorRequest: null,
            limit: 3,
            filters: null,
        })

        expect(page.data).toHaveLength(3)
        for (const record of page.data) {
            expect(record.cells[field.id]).toBeDefined()
            expect(record.cells[field.id].value).toMatch(/^val-\d+$/)
        }
    })
})
