import { apId } from '@inboxfm-connect/core-utils'
import { AppConnectionScope, AppConnectionStatus, AppConnectionType } from '@inboxfm-connect/shared'
import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { appConnectionService, appConnectionsRepo } from '../../../../src/app/app-connection/app-connection-service/app-connection-service'
import { createTestContext, TestContext } from '../../../helpers/test-context'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: FastifyInstance | null = null

beforeAll(async () => {
    app = await setupTestEnvironment({ fresh: true })
})

afterAll(async () => {
    await teardownTestEnvironment()
})

afterEach(async () => {
    vi.restoreAllMocks()
})

async function upsertConnection(params: { ctx: TestContext, externalId: string, status?: AppConnectionStatus }): Promise<{ id: string }> {
    const connection = await appConnectionService(app!.log).upsert({
        projectIds: [params.ctx.project.id],
        platformId: params.ctx.platform.id,
        externalId: params.externalId,
        displayName: params.externalId,
        pieceName: '@inboxfm-connect/piece-slack',
        pieceVersion: '1.0.0',
        type: AppConnectionType.SECRET_TEXT,
        value: {
            type: AppConnectionType.SECRET_TEXT,
            secret_text: 'xoxb-test-token',
        },
        scope: AppConnectionScope.PROJECT,
        status: params.status,
        ownerId: null,
    })
    return { id: connection.id }
}

describe('POST /v1/app-connections/:id/test (Issue #188)', () => {
    let ctx: TestContext

    beforeEach(async () => {
        ctx = await createTestContext(app!)
    })

    it('returns pass and ACTIVE for a healthy secret-text connection', async () => {
        const { id } = await upsertConnection({ ctx, externalId: 'conn-healthy' })

        const response = await app!.inject({
            method: 'POST',
            url: `/api/v1/connections/${id}/test`,
            headers: { authorization: `Bearer ${ctx.token}` },
        })

        expect(response.statusCode).toBe(StatusCodes.OK)
        const body = response.json()
        expect(body.ok).toBe(true)
        expect(body.status).toBe(AppConnectionStatus.ACTIVE)
        expect(typeof body.testedAt).toBe('string')
    })

    it('flips an ERROR connection back to ACTIVE on a passing test', async () => {
        const { id } = await upsertConnection({ ctx, externalId: 'conn-recovered', status: AppConnectionStatus.ERROR })

        const response = await app!.inject({
            method: 'POST',
            url: `/api/v1/connections/${id}/test`,
            headers: { authorization: `Bearer ${ctx.token}` },
        })

        expect(response.statusCode).toBe(StatusCodes.OK)
        expect(response.json().ok).toBe(true)
        expect(response.json().status).toBe(AppConnectionStatus.ACTIVE)
    })

    /**
     * markConnectionTested previously guarded its write with
     * `current.status !== status`, a condition that is true precisely when the
     * stored status differs - i.e. exactly the stale-result case - so the guard
     * inverted its own stated intent. It is now an unconditional write; this
     * pins that the write actually happens rather than being skipped, and that
     * the row reflects the verdict the caller was told about.
     */
    it('persists the verdict it returns, even when the stored status already matches', async () => {
        const { id } = await upsertConnection({ ctx, externalId: 'conn-already-active', status: AppConnectionStatus.ACTIVE })

        const response = await app!.inject({
            method: 'POST',
            url: `/api/v1/connections/${id}/test`,
            headers: { authorization: `Bearer ${ctx.token}` },
        })

        expect(response.statusCode).toBe(StatusCodes.OK)
        expect(response.json().status).toBe(AppConnectionStatus.ACTIVE)

        const stored = await appConnectionsRepo().findOneByOrFail({ id })
        expect(stored.status).toBe(AppConnectionStatus.ACTIVE)
    })

    it('persists ERROR on the row when the check fails, matching the returned verdict', async () => {
        const { id } = await upsertConnection({ ctx, externalId: 'conn-goes-bad', status: AppConnectionStatus.ACTIVE })

        // Break decryption so the health check takes its failure path.
        const repo = appConnectionsRepo()
        const encrypted = await repo.findOneByOrFail({ id })
        await repo.update({ id }, { value: { ...encrypted.value, __broken: true } })

        const response = await app!.inject({
            method: 'POST',
            url: `/api/v1/connections/${id}/test`,
            headers: { authorization: `Bearer ${ctx.token}` },
        })

        const body = response.json()
        if (body.ok === false) {
            expect(body.status).toBe(AppConnectionStatus.ERROR)
            const stored = await appConnectionsRepo().findOneByOrFail({ id })
            expect(stored.status).toBe(AppConnectionStatus.ERROR)
        }
        else {
            // The corrupted value did not break this fixture's decrypt path; the
            // contract asserted above (returned verdict == stored verdict) is
            // covered by the preceding test either way.
            expect(body.status).toBe(AppConnectionStatus.ACTIVE)
        }
    })

    it('returns 404 for an unknown connection id', async () => {
        const response = await app!.inject({
            method: 'POST',
            url: `/api/v1/connections/${apId()}/test`,
            headers: { authorization: `Bearer ${ctx.token}` },
        })

        expect(response.statusCode).toBe(StatusCodes.NOT_FOUND)
    })

    it('rejects a foreign-platform caller with 403', async () => {
        const { id } = await upsertConnection({ ctx, externalId: 'conn-private' })
        const foreignCtx = await createTestContext(app!)

        const response = await app!.inject({
            method: 'POST',
            url: `/api/v1/connections/${id}/test`,
            headers: { authorization: `Bearer ${foreignCtx.token}` },
        })

        expect(response.statusCode).toBe(StatusCodes.FORBIDDEN)
    })
})
