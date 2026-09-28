import { ExecutionStatus, executionUtils } from '@inboxfm-connect/shared'
import { describe, expect, it } from 'vitest'

describe('Execution Service Domain Logic', () => {
    describe('executionUtils.isValidExecutionStatusTransition', () => {
        it('allows CREATED -> RUNNING', () => {
            const valid = executionUtils.isValidExecutionStatusTransition({
                from: ExecutionStatus.CREATED,
                to: ExecutionStatus.RUNNING,
            })
            expect(valid).toBe(true)
        })

        it('allows RUNNING -> COMPLETED', () => {
            const valid = executionUtils.isValidExecutionStatusTransition({
                from: ExecutionStatus.RUNNING,
                to: ExecutionStatus.COMPLETED,
            })
            expect(valid).toBe(true)
        })

        it('allows RUNNING -> FAILED', () => {
            const valid = executionUtils.isValidExecutionStatusTransition({
                from: ExecutionStatus.RUNNING,
                to: ExecutionStatus.FAILED,
            })
            expect(valid).toBe(true)
        })

        it('allows RUNNING -> CANCELLED', () => {
            const valid = executionUtils.isValidExecutionStatusTransition({
                from: ExecutionStatus.RUNNING,
                to: ExecutionStatus.CANCELLED,
            })
            expect(valid).toBe(true)
        })

        it('rejects COMPLETED -> RUNNING', () => {
            const valid = executionUtils.isValidExecutionStatusTransition({
                from: ExecutionStatus.COMPLETED,
                to: ExecutionStatus.RUNNING,
            })
            expect(valid).toBe(false)
        })

        it('rejects FAILED -> COMPLETED', () => {
            const valid = executionUtils.isValidExecutionStatusTransition({
                from: ExecutionStatus.FAILED,
                to: ExecutionStatus.COMPLETED,
            })
            expect(valid).toBe(false)
        })

        it('rejects CANCELLED -> RUNNING', () => {
            const valid = executionUtils.isValidExecutionStatusTransition({
                from: ExecutionStatus.CANCELLED,
                to: ExecutionStatus.RUNNING,
            })
            expect(valid).toBe(false)
        })
    })

    describe('ListExecutionsRequestQuery Pagination Schema', () => {
        it('parses valid query with cursor, limit, and status', () => {
            const { ListExecutionsRequestQuery } = require('@inboxfm-connect/shared')
            const query = {
                projectId: 'proj_12345678901234567',
                status: ExecutionStatus.COMPLETED,
                limit: 25,
                cursor: 'bmV4dF8xNzAwMDAwMDAwMDAw',
            }

            const parsed = ListExecutionsRequestQuery.parse(query)
            expect(parsed.limit).toBe(25)
            expect(parsed.status).toBe(ExecutionStatus.COMPLETED)
            expect(parsed.cursor).toBe('bmV4dF8xNzAwMDAwMDAwMDAw')
        })

        it('defaults limit to 10 when omitted', () => {
            const { ListExecutionsRequestQuery } = require('@inboxfm-connect/shared')
            const parsed = ListExecutionsRequestQuery.parse({})
            expect(parsed.limit).toBe(10)
            expect(parsed.cursor).toBeUndefined()
        })
    })

    describe('Execution Pagination Helper Decode/Encode', () => {
        it('decodes next cursor correctly', async () => {
            const { paginationHelper } = await import('../../../../src/app/helper/pagination/pagination-utils')
            const cursor = Buffer.from('next_1700000000000').toString('base64')
            const decoded = paginationHelper.decodeCursor(cursor)

            expect(decoded.nextCursor).toBe('1700000000000')
            expect(decoded.previousCursor).toBeUndefined()
        })

        it('creates SeekPage with data and encoded cursor', async () => {
            const { paginationHelper } = await import('../../../../src/app/helper/pagination/pagination-utils')
            const page = paginationHelper.createPage([{ id: 'exec_1' }], {
                afterCursor: '1700000000000',
                beforeCursor: null,
            })

            expect(page.data).toHaveLength(1)
            expect(page.next).toBe(Buffer.from('next_1700000000000').toString('base64'))
            expect(page.previous).toBeNull()
        })
    })
})

