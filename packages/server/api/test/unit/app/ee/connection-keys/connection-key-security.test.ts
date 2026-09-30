import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockDelete = vi.fn().mockResolvedValue({ affected: 1 })

vi.mock('../../../../../src/app/core/db/repo-factory', () => ({
    repoFactory: vi.fn(() => () => ({
        delete: mockDelete,
    })),
}))

import { connectionKeyService } from '../../../../../src/app/ee/connection-keys/connection-key.service'
import { FastifyBaseLogger } from 'fastify'

const mockLog = {} as FastifyBaseLogger

describe('connectionKeyService — Security and Tenant Isolation (Issue #413)', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('scopes connection key deletion by both id and projectId', async () => {
        const id = 'ckey_123'
        const projectId = 'proj_456'

        await connectionKeyService(mockLog).delete({ id, projectId })

        expect(mockDelete).toHaveBeenCalledWith({
            id,
            projectId,
        })
    })
})
