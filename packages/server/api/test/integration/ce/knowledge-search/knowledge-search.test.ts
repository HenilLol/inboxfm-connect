import fastify, { FastifyInstance } from 'fastify'
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'
import { StatusCodes } from 'http-status-codes'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockQuery = vi.fn()

vi.mock('../../../../src/app/knowledge-search/knowledge-search.service', () => ({
    knowledgeSearchService: vi.fn(() => ({
        query: mockQuery,
    })),
}))

import { knowledgeSearchModule } from '../../../../src/app/knowledge-search/knowledge-search.module'

describe('Knowledge Search API Integration (POST /v1/knowledge-search/query)', () => {
    let app: FastifyInstance

    beforeEach(async () => {
        vi.clearAllMocks()
        app = fastify({ logger: false })
        app.setValidatorCompiler(validatorCompiler)
        app.setSerializerCompiler(serializerCompiler)

        app.addHook('preHandler', async (req) => {
            Object.assign(req, {
                principal: {
                    platform: { id: 'platform_test_id' },
                    type: 'USER',
                },
                projectId: 'project_test_id',
            })
        })

        await app.register(knowledgeSearchModule)
        await app.ready()
    })

    afterEach(async () => {
        await app.close()
    })

    it('rejects empty query with 400 validation error', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/v1/knowledge-search/query',
            payload: {
                query: '',
            },
        })

        expect(response.statusCode).toBe(StatusCodes.BAD_REQUEST)
        expect(mockQuery).not.toHaveBeenCalled()
    })

    it('enforces platformId and projectId scoping from request context', async () => {
        mockQuery.mockResolvedValueOnce({
            results: [],
            mode: 'keyword',
        })

        const response = await app.inject({
            method: 'POST',
            url: '/v1/knowledge-search/query',
            payload: {
                query: 'find customer',
            },
        })

        expect(response.statusCode).toBe(StatusCodes.OK)
        expect(mockQuery).toHaveBeenCalledWith(
            expect.objectContaining({
                platformId: 'platform_test_id',
                projectId: 'project_test_id',
                query: 'find customer',
            }),
        )
    })

    it('handles query against non-existent piece/KB returning empty results cleanly', async () => {
        mockQuery.mockResolvedValueOnce({
            results: [],
            mode: 'semantic',
        })

        const response = await app.inject({
            method: 'POST',
            url: '/v1/knowledge-search/query',
            payload: {
                query: 'unknown capability',
                pieceName: '@inboxfm-connect/piece-does-not-exist',
            },
        })

        expect(response.statusCode).toBe(StatusCodes.OK)
        const body = JSON.parse(response.body)
        expect(body.results).toEqual([])
        expect(mockQuery).toHaveBeenCalledWith(
            expect.objectContaining({
                pieceName: '@inboxfm-connect/piece-does-not-exist',
                query: 'unknown capability',
            }),
        )
    })

    it('filters by objectKind and limits results', async () => {
        const mockActionResults = [
            {
                pieceName: '@inboxfm-connect/piece-slack',
                objectName: 'send_message',
                objectKind: 'action' as const,
                displayName: 'Send Message',
                oneLineDescription: 'Send a Slack message',
                requiresConnection: true,
                cosine: 0.95,
                connected: true,
            },
        ]

        mockQuery.mockResolvedValueOnce({
            results: mockActionResults,
            mode: 'semantic',
        })

        const response = await app.inject({
            method: 'POST',
            url: '/v1/knowledge-search/query',
            payload: {
                query: 'post update',
                objectKind: 'action',
                limit: 5,
            },
        })

        expect(response.statusCode).toBe(StatusCodes.OK)
        const body = JSON.parse(response.body)
        expect(body.results).toHaveLength(1)
        expect(body.results[0].objectKind).toBe('action')
    })
})
