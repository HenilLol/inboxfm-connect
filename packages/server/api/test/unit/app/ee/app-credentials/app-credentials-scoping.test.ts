import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockWhere = vi.fn().mockReturnThis()
const mockAndWhere = vi.fn().mockReturnThis()
const mockPaginate = vi.fn().mockResolvedValue({ data: [], cursor: null })

const mockQueryBuilder = {
    where: mockWhere,
    andWhere: mockAndWhere,
}

vi.mock('../../../../../src/app/core/db/repo-factory', () => ({
    repoFactory: vi.fn(() => () => ({
        createQueryBuilder: vi.fn(() => mockQueryBuilder),
        findOneByOrFail: vi.fn(),
    })),
}))

vi.mock('../../../../../src/app/helper/pagination/build-paginator', () => ({
    buildPaginator: vi.fn(() => ({
        paginate: mockPaginate,
    })),
}))

import { appCredentialService } from '../../../../../src/app/ee/app-credentials/app-credentials.service'

describe('appCredentialService — Project Scoping Security (Issue #415)', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('retains projectId filter when appName query parameter is supplied', async () => {
        const projectId = 'proj_123'
        const appName = 'google'

        await appCredentialService.list(projectId, appName, null, 10)

        // Verify initial where call receives { projectId }
        expect(mockWhere).toHaveBeenCalledWith({ projectId })
        // Verify subsequent filter calls andWhere (NOT where) so projectId is preserved
        expect(mockAndWhere).toHaveBeenCalledWith({ appName })
    })

    it('filters by projectId alone when appName is undefined', async () => {
        const projectId = 'proj_456'

        await appCredentialService.list(projectId, undefined, null, 10)

        expect(mockWhere).toHaveBeenCalledWith({ projectId })
        expect(mockAndWhere).not.toHaveBeenCalled()
    })
})
