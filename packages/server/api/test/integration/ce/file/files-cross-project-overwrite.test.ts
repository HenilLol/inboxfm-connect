import { apId } from '@inboxfm-connect/core-utils'
import { FileType, PrincipalType } from '@inboxfm-connect/shared'
import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { fileRepo } from '../../../../src/app/file/file.service'
import { generateMockToken } from '../../../helpers/auth'
import { mockAndSaveBasicSetup } from '../../../helpers/mocks'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: FastifyInstance | null = null

beforeAll(async () => {
    app = await setupTestEnvironment()
})

afterAll(async () => {
    await teardownTestEnvironment()
})

async function engineToken(projectId: string, platformId: string): Promise<string> {
    return generateMockToken({
        type: PrincipalType.ENGINE,
        id: apId(),
        projectId,
        platform: { id: platformId },
    })
}

describe('Files Controller — cross-project PUT ownership', () => {
    it('rejects an engine PUT over a file id owned by another project with 403', async () => {
        // Project A (victim) saves a step file with its own engine token.
        const victimSetup = await mockAndSaveBasicSetup()
        const victimToken = await engineToken(victimSetup.mockProject.id, victimSetup.mockPlatform.id)
        const fileId = apId()

        const firstPut = await app!.inject({
            method: 'PUT',
            url: `/api/v1/files/${fileId}`,
            query: { token: victimToken },
            headers: {
                'content-type': 'application/octet-stream',
                'x-ap-file-type': FileType.FLOW_STEP_FILE,
                'x-ap-file-name': 'victim.txt',
            },
            payload: Buffer.from('victim-owned content'),
        })
        expect(firstPut?.statusCode).toBe(StatusCodes.OK)

        const saved = await fileRepo().findOneByOrFail({ id: fileId })
        expect(saved.projectId).toBe(victimSetup.mockProject.id)

        // Project B (attacker, same platform) tries to overwrite the same file id.
        const attackerSetup = await mockAndSaveBasicSetup({ platform: victimSetup.mockPlatform })
        const attackerToken = await engineToken(attackerSetup.mockProject.id, attackerSetup.mockPlatform.id)

        const secondPut = await app!.inject({
            method: 'PUT',
            url: `/api/v1/files/${fileId}`,
            query: { token: attackerToken },
            headers: {
                'content-type': 'application/octet-stream',
                'x-ap-file-type': FileType.FLOW_STEP_FILE,
                'x-ap-file-name': 'attacker.txt',
            },
            payload: Buffer.from('attacker overwrite'),
        })

        // Must be denied: the file id belongs to another project.
        expect(secondPut?.statusCode).toBe(StatusCodes.FORBIDDEN)

        // And the victim row is untouched.
        const after = await fileRepo().findOneByOrFail({ id: fileId })
        expect(after.projectId).toBe(victimSetup.mockProject.id)
        expect(after.fileName).toBe('victim.txt')
    })


    it('serializes concurrent first writes: the second project cannot overwrite the winner row', async () => {
        // Deterministic interleave of the unguarded window: both requests are held
        // at their ownership lookup until both arrive (or a short timeout lapses,
        // so the serialized/guarded path cannot deadlock on the barrier). Without
        // the per-fileId mutex both lookups observe no row and both saves proceed —
        // the later save overwrites the winner's row, so both PUTs answer 200. With
        // the mutex the second guard runs only after the winner's save commits, sees
        // the foreign-owned row, and answers 403.
        const setupA = await mockAndSaveBasicSetup()
        const tokenA = await engineToken(setupA.mockProject.id, setupA.mockPlatform.id)
        const setupB = await mockAndSaveBasicSetup()
        const tokenB = await engineToken(setupB.mockProject.id, setupB.mockPlatform.id)
        const contestedId = apId()

        const barrier = {
            arrived: 0,
            target: 2,
            release: null as null | (() => void),
        }
        const BARRIER_TIMEOUT_MS = 2_000
        const realFindOneBy = fileRepo().findOneBy.bind(fileRepo())
        vi.spyOn(fileRepo(), 'findOneBy').mockImplementation(async (where) => {
            const isGuardLookup = (where as { id?: string })?.id === contestedId && Object.keys(where as object).length === 1
            if (isGuardLookup) {
                barrier.arrived += 1
                if (barrier.arrived >= barrier.target) {
                    barrier.release?.()
                }
                else {
                    // Bounded wait: in the guarded (serialized) world the second
                    // lookup cannot arrive until the first request finishes, so the
                    // barrier lapses instead of hanging.
                    await Promise.race([
                        new Promise<void>(resolve => {
                            barrier.release = resolve
                        }),
                        new Promise<void>(resolve => setTimeout(resolve, BARRIER_TIMEOUT_MS)),
                    ])
                }
            }
            return realFindOneBy(where as never)
        })

        try {
            const put = (token: string, content: string) => app!.inject({
                method: 'PUT',
                url: `/api/v1/files/${contestedId}`,
                query: { token },
                headers: {
                    'content-type': 'application/octet-stream',
                    'x-ap-file-type': FileType.FLOW_STEP_FILE,
                },
                payload: Buffer.from(content),
            })

            const [resA, resB] = await Promise.all([put(tokenA, 'A-writes'), put(tokenB, 'B-writes')])

            const statuses = [resA?.statusCode, resB?.statusCode].sort()
            expect(statuses[0]).toBe(StatusCodes.OK)
            expect(statuses[1]).toBe(StatusCodes.FORBIDDEN)

            // The 200 responder is the winner; the row must be theirs and only theirs.
            const winnerProjectId = resA?.statusCode === StatusCodes.OK ? setupA.mockProject.id : setupB.mockProject.id
            const row = await fileRepo().findOneByOrFail({ id: contestedId })
            expect(row.projectId).toBe(winnerProjectId)
        }
        finally {
            vi.restoreAllMocks()
        }
    })

    it('still allows the owning project to re-PUT its own file id (retry path)', async () => {
        const setup = await mockAndSaveBasicSetup()
        const token = await engineToken(setup.mockProject.id, setup.mockPlatform.id)
        const fileId = apId()

        const first = await app!.inject({
            method: 'PUT',
            url: `/api/v1/files/${fileId}`,
            query: { token },
            headers: {
                'content-type': 'application/octet-stream',
                'x-ap-file-type': FileType.FLOW_STEP_FILE,
            },
            payload: Buffer.from('first write'),
        })
        expect(first?.statusCode).toBe(StatusCodes.OK)

        const second = await app!.inject({
            method: 'PUT',
            url: `/api/v1/files/${fileId}`,
            query: { token },
            headers: {
                'content-type': 'application/octet-stream',
                'x-ap-file-type': FileType.FLOW_STEP_FILE,
            },
            payload: Buffer.from('retry write'),
        })
        expect(second?.statusCode).toBe(StatusCodes.OK)

        const after = await fileRepo().findOneByOrFail({ id: fileId })
        expect(after.projectId).toBe(setup.mockProject.id)
    })
})
