import { describe, expect, it } from 'vitest'
import { EntitySchema } from 'typeorm'
import Paginator from '../../../../../src/app/helper/pagination/paginator'

const dummyEntitySchema = new EntitySchema({
    name: 'Dummy',
    tableName: 'dummy',
    columns: {
        id: {
            primary: true,
            type: 'varchar',
        },
        created: {
            type: 'timestamp with time zone',
        },
    },
})

describe('Paginator — Malformed Cursor Decoding (Issue #411)', () => {
    it('returns empty cursor params for malformed base64 cursor without throwing 500 error', () => {
        const paginator = new Paginator(dummyEntitySchema)
        paginator.setAfterCursor('invalid_base64_string_xyz_!!!')

        // Access private decode method to verify safe fallback
        const decoded = (paginator as unknown as { decode(c: string): Record<string, unknown> }).decode('invalid_base64_string_xyz_!!!')
        expect(decoded).toEqual({})
    })

    it('returns empty cursor params when cursor specifies non-existent column', () => {
        const paginator = new Paginator(dummyEntitySchema)
        // Base64 for "nonexistent_col:12345"
        const forgedCursor = Buffer.from('nonexistent_col:12345').toString('base64')

        const decoded = (paginator as unknown as { decode(c: string): Record<string, unknown> }).decode(forgedCursor)
        expect(decoded).toEqual({})
    })

    it('returns empty cursor params when cursor specifies invalid date value', () => {
        const paginator = new Paginator(dummyEntitySchema)
        // Base64 for "created:invalid_date"
        const invalidDateCursor = Buffer.from('created:invalid_date').toString('base64')

        const decoded = (paginator as unknown as { decode(c: string): Record<string, unknown> }).decode(invalidDateCursor)
        expect(decoded).toEqual({})
    })
})
