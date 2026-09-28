import { faker } from '@faker-js/faker'
import { ActivepiecesError, apId, secureApId } from '@inboxfm-connect/core-utils'
import { cryptoUtils } from '@inboxfm-connect/server-utils'
import { connectSessionService } from '../../../../src/app/connect-sessions/connect-session.service'
import { db } from '../../../helpers/db'
import { mockAndSaveBasicSetup } from '../../../helpers/mocks'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

beforeAll(async () => {
    await setupTestEnvironment()
})

afterAll(async () => {
    await teardownTestEnvironment()
})

function mockConnectSession(projectId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    const raw = `cs-${secureApId(61)}`
    return {
        id: apId(),
        created: faker.date.recent().toISOString(),
        updated: faker.date.recent().toISOString(),
        projectId,
        externalUserId: faker.string.alphanumeric(10),
        allowedPieceNames: null,
        hashedToken: cryptoUtils.hashSHA256(raw),
        truncatedToken: raw.slice(-4),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        consumedAt: null,
        ...overrides,
    }
}

describe('Connect session single-use guarantee (consumeOrThrow)', () => {
    it('rejects a second redemption of the same session id', async () => {
        const { mockProject } = await mockAndSaveBasicSetup()
        const session = mockConnectSession(mockProject.id)
        await db.save('connect_session', session)

        await expect(connectSessionService.consumeOrThrow(session.id as string)).resolves.toBeUndefined()
        await expect(connectSessionService.consumeOrThrow(session.id as string)).rejects.toThrow(ActivepiecesError)
    })

    it('rejects consumption of an expired session even when consumedAt is null', async () => {
        const { mockProject } = await mockAndSaveBasicSetup()
        const session = mockConnectSession(mockProject.id, {
            expiresAt: new Date(Date.now() - 60_000).toISOString(),
        })
        await db.save('connect_session', session)

        await expect(connectSessionService.consumeOrThrow(session.id as string)).rejects.toThrow(ActivepiecesError)
    })

    it('does not overwrite an existing consumedAt timestamp', async () => {
        const { mockProject } = await mockAndSaveBasicSetup()
        const originalConsumedAt = new Date(Date.now() - 30_000).toISOString()
        const session = mockConnectSession(mockProject.id, { consumedAt: originalConsumedAt })
        await db.save('connect_session', session)

        await expect(connectSessionService.consumeOrThrow(session.id as string)).rejects.toThrow(ActivepiecesError)
        const stored = await db.findOneByOrFail<{ consumedAt: string | null }>('connect_session', { id: session.id })
        expect(stored.consumedAt).toBe(originalConsumedAt)
    })
})

describe('Connect session cleanup (deleteExpiredBefore)', () => {
    it('removes sessions expired before the boundary and keeps live ones', async () => {
        const { mockProject } = await mockAndSaveBasicSetup()
        const expiredConsumed = mockConnectSession(mockProject.id, {
            expiresAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
            consumedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        })
        const expiredUnconsumed = mockConnectSession(mockProject.id, {
            expiresAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        })
        const liveSession = mockConnectSession(mockProject.id)
        await db.save('connect_session', [expiredConsumed, expiredUnconsumed, liveSession])

        const boundary = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
        const deleted = await connectSessionService.deleteExpiredBefore({ boundaryIso: boundary })

        expect(deleted).toBe(2)
        await expect(db.findOneBy('connect_session', { id: expiredConsumed.id })).resolves.toBeNull()
        await expect(db.findOneBy('connect_session', { id: expiredUnconsumed.id })).resolves.toBeNull()
        await expect(db.findOneBy('connect_session', { id: liveSession.id })).resolves.not.toBeNull()
    })

    it('is a no-op when nothing is eligible', async () => {
        const deleted = await connectSessionService.deleteExpiredBefore({
            boundaryIso: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        })
        expect(deleted).toBe(0)
    })
})