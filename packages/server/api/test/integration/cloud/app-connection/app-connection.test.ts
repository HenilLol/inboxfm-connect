import { ActivepiecesError, apId, ErrorCode } from '@inboxfm-connect/core-utils'
import {
    AppConnection,
    AppConnectionScope,
    AppConnectionStatus,
    AppConnectionType,
    DefaultProjectRole,
    PackageType,
} from '@inboxfm-connect/shared'
import { FastifyBaseLogger, FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { appConnectionService } from '../../../../src/app/app-connection/app-connection-service/app-connection-service'
import { databaseConnection } from '../../../../src/app/database/database-connection'
import { pieceMetadataService } from '../../../../src/app/pieces/metadata/piece-metadata-service'
import { db } from '../../../helpers/db'
import {
    createMockPieceMetadata,
} from '../../../helpers/mocks'
import { describeRolePermissions } from '../../../helpers/permission-test'
import { createTestContext } from '../../../helpers/test-context'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: FastifyInstance | null = null
let mockLog: FastifyBaseLogger

beforeAll(async () => {
    app = await setupTestEnvironment()
    mockLog = app!.log!
})

afterAll(async () => {
    await teardownTestEnvironment()
})

describe('AppConnection API', () => {
    describe('Upsert AppConnection endpoint', () => {
        it('Succeeds with metadata field', async () => {
            const ctx = await createTestContext(app!)

            const mockPieceMetadata = createMockPieceMetadata({
                platformId: ctx.platform.id,
                packageType: PackageType.REGISTRY,
            })
            await db.save('integration_metadata', mockPieceMetadata)
            pieceMetadataService(mockLog).getOrThrow = vi.fn().mockResolvedValue(mockPieceMetadata)

            const response = await ctx.post('/v1/connections', {
                externalId: 'test-app-connection-with-metadata',
                displayName: 'Test Connection with Metadata',
                pieceName: mockPieceMetadata.name,
                projectId: ctx.project.id,
                type: AppConnectionType.SECRET_TEXT,
                value: {
                    type: AppConnectionType.SECRET_TEXT,
                    secret_text: 'test-secret-text',
                },
                metadata: { foo: 'bar' },
                pieceVersion: mockPieceMetadata.version,
            })

            expect(response?.statusCode).toBe(StatusCodes.CREATED)
            const responseBody = response?.json()
            expect(responseBody.metadata).toEqual({ foo: 'bar' })
            expect(responseBody.pieceVersion).toEqual(mockPieceMetadata.version)

            const updateResponse = await ctx.post(`/v1/connections/${responseBody.id}`, {
                displayName: 'Updated Connection Name',
                metadata: { foo: 'baz' },
            })

            expect(updateResponse?.statusCode).toBe(StatusCodes.OK)
            const updatedResponseBody = updateResponse?.json()
            expect(updatedResponseBody.metadata).toEqual({ foo: 'baz' })
        })

        describeRolePermissions({
            app: () => app!,
            request: async (memberCtx, ownerCtx) => {
                const mockPieceMetadata = createMockPieceMetadata({
                    platformId: ownerCtx.platform.id,
                    packageType: PackageType.REGISTRY,
                })
                await db.save('integration_metadata', mockPieceMetadata)
                pieceMetadataService(mockLog).getOrThrow = vi.fn().mockResolvedValue(mockPieceMetadata)

                return memberCtx.post('/v1/connections', {
                    externalId: 'test-app-connection',
                    displayName: 'test-app-connection',
                    pieceName: mockPieceMetadata.name,
                    projectId: ownerCtx.project.id,
                    type: AppConnectionType.SECRET_TEXT,
                    value: {
                        type: AppConnectionType.SECRET_TEXT,
                        secret_text: 'test-secret-text',
                    },
                    pieceVersion: mockPieceMetadata.version,
                })
            },
            allowedRoles: [DefaultProjectRole.ADMIN, DefaultProjectRole.EDITOR],
            forbiddenRoles: [DefaultProjectRole.VIEWER],
        })
    })

    describe('List AppConnections endpoint', () => {
        describeRolePermissions({
            app: () => app!,
            request: (memberCtx, ownerCtx) => {
                return memberCtx.get('/v1/connections', {
                    projectId: ownerCtx.project.id,
                })
            },
            allowedRoles: [DefaultProjectRole.ADMIN, DefaultProjectRole.EDITOR, DefaultProjectRole.VIEWER],
            forbiddenRoles: [],
        })
    })

    describe('Update AppConnection endpoint', () => {
        it('updates a valid connection and returns updated data', async () => {
            const ctx = await createTestContext(app!)

            const mockPieceMetadata = createMockPieceMetadata({
                platformId: ctx.platform.id,
                packageType: PackageType.REGISTRY,
            })
            await db.save('integration_metadata', mockPieceMetadata)
            pieceMetadataService(mockLog).getOrThrow = vi.fn().mockResolvedValue(mockPieceMetadata)

            const createResponse = await ctx.post('/v1/connections', {
                externalId: 'test-app-connection-valid-update',
                displayName: 'Original Name',
                pieceName: mockPieceMetadata.name,
                projectId: ctx.project.id,
                type: AppConnectionType.SECRET_TEXT,
                value: {
                    type: AppConnectionType.SECRET_TEXT,
                    secret_text: 'test-secret',
                },
                metadata: { env: 'staging' },
                pieceVersion: mockPieceMetadata.version,
            })

            expect(createResponse?.statusCode).toBe(StatusCodes.CREATED)
            const createdBody = createResponse?.json()

            const updateResponse = await ctx.post(`/v1/connections/${createdBody.id}`, {
                displayName: 'New Valid Name',
                metadata: { env: 'production' },
            })

            expect(updateResponse?.statusCode).toBe(StatusCodes.OK)
            const updatedBody = updateResponse?.json()
            expect(updatedBody.displayName).toBe('New Valid Name')
            expect(updatedBody.metadata).toEqual({ env: 'production' })
            expect(updatedBody.id).toBe(createdBody.id)
        })

        it('returns 404 ENTITY_NOT_FOUND when updating a non-existent connection', async () => {
            const ctx = await createTestContext(app!)
            const nonExistentId = apId()

            const response = await ctx.post(`/v1/connections/${nonExistentId}`, {
                displayName: 'Non-existent Connection Name',
            })

            expect(response?.statusCode).toBe(StatusCodes.NOT_FOUND)
            const body = response?.json()
            expect(body.code).toBe('ENTITY_NOT_FOUND')
            expect(body.params.entityId).toBe(nonExistentId)
        })

        it('returns 403 AUTHORIZATION when updating a connection belonging to another platform', async () => {
            const ctx1 = await createTestContext(app!)
            const ctx2 = await createTestContext(app!)

            const mockPieceMetadata = createMockPieceMetadata({
                platformId: ctx1.platform.id,
                packageType: PackageType.REGISTRY,
            })
            await db.save('integration_metadata', mockPieceMetadata)
            pieceMetadataService(mockLog).getOrThrow = vi.fn().mockResolvedValue(mockPieceMetadata)

            const createResponse = await ctx1.post('/v1/connections', {
                externalId: 'conn-platform-1-cross-test',
                displayName: 'Platform 1 Original Name',
                pieceName: mockPieceMetadata.name,
                projectId: ctx1.project.id,
                type: AppConnectionType.SECRET_TEXT,
                value: {
                    type: AppConnectionType.SECRET_TEXT,
                    secret_text: 'p1-secret',
                },
                pieceVersion: mockPieceMetadata.version,
            })
            const created = createResponse?.json()

            const updateResponse = await ctx2.post(`/v1/connections/${created.id}`, {
                displayName: 'Attacked Connection Name',
            })

            expect(updateResponse?.statusCode).toBe(StatusCodes.FORBIDDEN)
            const body = updateResponse?.json()
            expect(body.code).toBe('AUTHORIZATION')

            const checkOriginal = await db.findOneBy<AppConnection>('app_connection', { id: created.id })
            expect(checkOriginal).toBeDefined()
            expect(checkOriginal?.displayName).toBe('Platform 1 Original Name')
        })

        it('propagates unexpected database errors as 500 without converting to 404', async () => {
            const ctx = await createTestContext(app!)

            const mockPieceMetadata = createMockPieceMetadata({
                platformId: ctx.platform.id,
                packageType: PackageType.REGISTRY,
            })
            await db.save('integration_metadata', mockPieceMetadata)
            pieceMetadataService(mockLog).getOrThrow = vi.fn().mockResolvedValue(mockPieceMetadata)

            const createResponse = await ctx.post('/v1/connections', {
                externalId: 'test-db-error-conn',
                displayName: 'DB Error Test',
                pieceName: mockPieceMetadata.name,
                projectId: ctx.project.id,
                type: AppConnectionType.SECRET_TEXT,
                value: {
                    type: AppConnectionType.SECRET_TEXT,
                    secret_text: 'db-error-secret',
                },
                pieceVersion: mockPieceMetadata.version,
            })
            const created = createResponse?.json()

            const repo = databaseConnection().getRepository('app_connection')
            const updateSpy = vi.spyOn(repo, 'update').mockRejectedValueOnce(new Error('Simulated database connection failure'))

            try {
                const response = await ctx.post(`/v1/connections/${created.id}`, {
                    displayName: 'Should Fail With 500',
                })

                expect(response?.statusCode).toBe(StatusCodes.INTERNAL_SERVER_ERROR)
                const body = response?.json()
                expect(body.code).not.toBe('ENTITY_NOT_FOUND')
            }
            finally {
                updateSpy.mockRestore()
            }
        })
    })

    describe('appConnectionService.update (service-level)', () => {
        it('throws ENTITY_NOT_FOUND ActivepiecesError when connection does not exist in scope', async () => {
            const ctx = await createTestContext(app!)
            const nonExistentId = apId()

            const updatePromise = appConnectionService(mockLog).update({
                id: nonExistentId,
                platformId: ctx.platform.id,
                projectIds: [ctx.project.id],
                scope: AppConnectionScope.PROJECT,
                request: {
                    displayName: 'Missing Connection',
                    projectIds: null,
                },
            })

            await expect(updatePromise).rejects.toBeInstanceOf(ActivepiecesError)
            await expect(updatePromise).rejects.toMatchObject({
                error: {
                    code: ErrorCode.ENTITY_NOT_FOUND,
                    params: {
                        entityType: 'AppConnection',
                        entityId: nonExistentId,
                    },
                },
            })
        })

        it('throws ENTITY_NOT_FOUND ActivepiecesError when connection belongs to another platform', async () => {
            const ctx1 = await createTestContext(app!)
            const ctx2 = await createTestContext(app!)

            const mockPieceMetadata = createMockPieceMetadata({
                platformId: ctx1.platform.id,
                packageType: PackageType.REGISTRY,
            })
            await db.save('integration_metadata', mockPieceMetadata)
            pieceMetadataService(mockLog).getOrThrow = vi.fn().mockResolvedValue(mockPieceMetadata)

            const created = await appConnectionService(mockLog).upsert({
                externalId: 'service-level-cross-platform-test',
                displayName: 'Platform 1 Original Name',
                pieceName: mockPieceMetadata.name,
                ownerId: null,
                projectIds: [ctx1.project.id],
                platformId: ctx1.platform.id,
                type: AppConnectionType.SECRET_TEXT,
                value: {
                    type: AppConnectionType.SECRET_TEXT,
                    secret_text: 'p1-secret',
                },
                scope: AppConnectionScope.PROJECT,
                status: AppConnectionStatus.ACTIVE,
                pieceVersion: mockPieceMetadata.version,
            })

            const updatePromise = appConnectionService(mockLog).update({
                id: created.id,
                platformId: ctx2.platform.id,
                projectIds: [ctx2.project.id],
                scope: AppConnectionScope.PROJECT,
                request: {
                    displayName: 'Cross Platform Update Name',
                    projectIds: null,
                },
            })

            await expect(updatePromise).rejects.toBeInstanceOf(ActivepiecesError)
            await expect(updatePromise).rejects.toMatchObject({
                error: {
                    code: ErrorCode.ENTITY_NOT_FOUND,
                    params: {
                        entityType: 'AppConnection',
                        entityId: created.id,
                    },
                },
            })
        })
    })
})
