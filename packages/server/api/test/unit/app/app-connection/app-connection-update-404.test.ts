import { describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '@inboxfm-connect/core-utils'
import { AppConnectionScope } from '@inboxfm-connect/shared'

// The key invariant tested here: when findOneBy returns null (connection missing
// or belonging to another tenant), the service must throw an ActivepiecesError
// with code ENTITY_NOT_FOUND instead of calling update() and crashing on
// findOneByOrFail (which would become HTTP 500 via TypeORM).

const findOneByMock = vi.fn()
const updateMock = vi.fn()
const findOneByOrFailMock = vi.fn()

vi.mock(
    '../../../../src/app/core/db/repo-factory',
    () => ({
        repoFactory: vi.fn(() => () => ({
            findOneBy: findOneByMock,
            update: updateMock,
            findOneByOrFail: findOneByOrFailMock,
        })),
    }),
)
vi.mock('../../../../src/app/app-connection/app-connection-service/app-connection.handler', () => ({ appConnectionHandler: {} }))
vi.mock('../../../../src/app/app-connection/app-connection-service/oauth2', () => ({ oauth2Handler: {} }))
vi.mock('../../../../src/app/app-connection/app-connection-service/oauth2/oauth2-util', () => ({ oauth2Util: {} }))
vi.mock('../../../../src/app/ee/projects/project-members/project-member.service', () => ({ projectMemberService: vi.fn() }))
vi.mock('../../../../src/app/ee/secret-managers/secret-managers.service', () => ({
    containsSecretManagerReference: vi.fn().mockResolvedValue(false),
    secretManagersService: vi.fn(),
}))
vi.mock('../../../../src/app/pieces/metadata/piece-metadata-service', () => ({
    pieceMetadataService: vi.fn(),
    getPiecePackageWithoutArchive: vi.fn(),
}))
vi.mock('../../../../src/app/project/project-service', () => ({ projectRepo: vi.fn() }))
vi.mock('../../../../src/app/user/user-service', () => ({ userService: vi.fn() }))
vi.mock('../../../../src/app/helper/encryption', () => ({
    encryptUtils: { encryptObject: vi.fn(), decryptObject: vi.fn() },
}))
vi.mock('../../../../src/app/helper/system/system', () => ({ system: { getOrThrow: vi.fn(), get: vi.fn() } }))
vi.mock('../../../../src/app/helper/user-interaction/user-interaction-watcher', () => ({
    userInteractionWatcher: { submitAndWaitForResponse: vi.fn() },
}))

import { appConnectionService } from '../../../../src/app/app-connection/app-connection-service/app-connection-service'

const fakeLog = {
    info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), trace: vi.fn(),
    child: vi.fn(() => fakeLog),
} as any

describe('appConnectionService.update() — issue #155', () => {
    it('throws ENTITY_NOT_FOUND (HTTP 404) when the connection does not exist', async () => {
        findOneByMock.mockResolvedValue(null)

        const caughtError: any = await appConnectionService(fakeLog)
            .update({
                id: 'missing-connection-id',
                platformId: 'platform-1',
                projectIds: ['project-1'],
                scope: AppConnectionScope.PROJECT,
                request: { displayName: 'new name' },
            })
            .catch((e: unknown) => e)

        expect(caughtError).toBeDefined()
        // ActivepiecesError wraps the code under .error.code
        const code = (caughtError as any)?.error?.code ?? (caughtError as any)?.code
        expect(code).toBe(ErrorCode.ENTITY_NOT_FOUND)
    })

    it('does not call repo.update when the connection is missing', async () => {
        findOneByMock.mockResolvedValue(null)
        updateMock.mockClear()

        await appConnectionService(fakeLog)
            .update({
                id: 'missing-id-2',
                platformId: 'p',
                projectIds: ['proj'],
                scope: AppConnectionScope.PROJECT,
                request: { displayName: 'irrelevant' },
            })
            .catch(() => { /* expected throw */ })

        expect(updateMock).not.toHaveBeenCalled()
    })
})
