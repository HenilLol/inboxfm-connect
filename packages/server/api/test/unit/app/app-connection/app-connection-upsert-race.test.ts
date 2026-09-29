import {FastifyBaseLogger} from 'fastify'
import {beforeEach, describe, expect, it, vi} from 'vitest'

// Race regression (issue F29): two overlapping upserts of the same
// (externalId, scope, platformId, projectIds) used to both read "no existing
// row" and insert two rows with different apIds. The fix serializes the
// read-modify-write behind a per-key distributed lock (SET NX) and re-reads
// after acquiring it; the loser must reuse the winner's row id.

const mockFindOneBy = vi.fn()
const mockUpsert = vi.fn()
const mockRepoFindOneByOrFail = vi.fn()

vi.mock('../../../../src/app/core/db/repo-factory', () => ({
    repoFactory: () => () => ({
        findOneBy: mockFindOneBy,
        upsert: mockUpsert,
        findOneByOrFail: mockRepoFindOneByOrFail,
    }),
}))

const mockPutIfAbsent = vi.fn()

vi.mock('../../../../src/app/database/redis-connections', () => ({
    distributedStore: {
        putIfAbsent: mockPutIfAbsent,
    },
}))

vi.mock('../../../../src/app/ee/projects/project-members/project-member.service', () => ({
    projectMemberService: {},
}))
vi.mock('../../../../src/app/ee/secret-managers/secret-managers.service', () => ({
    secretManagersService: () => ({resolveObject: async ({value}: {value: unknown}) => value}),
    containsSecretManagerReference: () => false,
}))
vi.mock('../../../../src/app/helper/encryption', () => ({
    encryptUtils: {encryptObject: async (v: unknown) => v},
    EncryptedObject: {},
}))
vi.mock('../../../../src/app/helper/system/system', () => ({
    system: {get: () => 'test'},
}))
vi.mock('../../../../src/app/pieces/metadata/piece-metadata-service', () => ({
    pieceMetadataService: () => ({getOrThrow: async () => ({version: '0.0.1'})}),
    getPiecePackageWithoutArchive: vi.fn(),
}))
vi.mock('../../../../src/app/project/project-service', () => ({
    projectRepo: () => ({countBy: async () => 1}),
}))
vi.mock('../../../../src/app/user/user-service', () => ({
    userService: {},
}))

const mockLog: FastifyBaseLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn(),
    silent: vi.fn(),
    level: 'info',
} as unknown as FastifyBaseLogger

type AppConnectionService = ReturnType<typeof import('../../../../src/app/app-connection/app-connection-service/app-connection-service').appConnectionService>

async function loadService(): Promise<AppConnectionService> {
    const mod = await import('../../../../src/app/app-connection/app-connection-service/app-connection-service')
    return mod.appConnectionService(mockLog)
}

const baseUpsert = {
    externalId: 'ext-1',
    pieceName: 'openai',
    displayName: 'Race Conn',
    platformId: 'platform-1',
    projectIds: ['proj-1'],
    scope: 'PROJECT',
    type: 'NO_AUTH',
    value: {type: 'NO_AUTH'},
}

describe('appConnectionService.upsert race (issue F29)', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.resetModules()
    })

    it('second upsert after lock acquisition re-reads and reuses the existing row id', async () => {
        // request B acquires the lock; request A lost it. A must NOT insert a new
        // id: it must re-lookup and find B's row.
        const winnerRow = {id: 'conn_winner', externalId: 'ex-1', status: 'ACTIVE'}
        mockFindOneBy
            .mockResolvedValueOnce(null)      // B (winner) initial read: none
            .mockResolvedValueOnce(winnerRow)  // A re-read after losing lock: B's row
        mockPutIfAbsent.mockResolvedValueOnce(false) // A loses the lock
        mockUpsert.mockResolvedValue(undefined)
        mockRepoFindOneByOrFail.mockResolvedValue(winnerRow)

        const service = await loadService()
        const result = await service.upsert(baseUpsert)

        expect(mockUpsert).toHaveBeenCalledTimes(1)
        const upsertedConnection = mockUpsert.mock.calls[0][0]
        expect(upsertedConnection.id).toBe('conn_winner')
        expect(result.id).toBe('conn_winner')
    })
})
