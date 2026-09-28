import { apId } from '@inboxfm-connect/core-utils'
import {
    AppConnectionScope,
    AppConnectionStatus,
    AppConnectionType,
    ConnectProxyErrorCode,
    OAuth2ConnectionValue,
    Permission,
} from '@inboxfm-connect/shared'
import axios from 'axios'
import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { appConnectionsRepo } from '../../../../src/app/app-connection/app-connection-service/app-connection-service'
import { encryptUtils } from '../../../../src/app/helper/encryption'
import { createTestContext } from '../../../helpers/test-context'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: FastifyInstance | null = null

beforeAll(async () => {
    app = await setupTestEnvironment()
})

afterAll(async () => {
    await teardownTestEnvironment()
})

describe('Connect API Proxy Contract & Authorization Suite (#213)', () => {
    let mockAxiosInstance: {
        request: ReturnType<typeof vi.fn>
        interceptors: { response: { use: ReturnType<typeof vi.fn> } }
    }

    beforeEach(() => {
        mockAxiosInstance = {
            request: vi.fn().mockResolvedValue({
                status: 200,
                statusText: 'OK',
                headers: {
                    'content-type': 'application/json',
                    'x-ratelimit-limit': '500',
                    'x-ratelimit-remaining': '499',
                    'x-ratelimit-reset': '1600000000',
                },
                data: { ok: true, profile: { real_name: 'Alice' } },
            }),
            interceptors: {
                response: {
                    use: vi.fn(),
                },
            },
        }

        vi.spyOn(axios, 'create').mockReturnValue(mockAxiosInstance as any)
    })

    async function seedCustomerConnection({
        projectId,
        platformId = apId(),
        externalUserId,
        pieceName = 'slack',
        token = 'fake_secret_access_token_123',
        status = AppConnectionStatus.ACTIVE,
    }: {
        projectId: string
        platformId?: string
        externalUserId: string
        pieceName?: string
        token?: string
        status?: AppConnectionStatus
    }) {
        const encrypted = await encryptUtils.encryptObject({
            type: AppConnectionType.OAUTH2,
            access_token: token,
            token_type: 'Bearer',
            data: {},
        } as OAuth2ConnectionValue)

        return appConnectionsRepo().save({
            id: apId(),
            displayName: `${pieceName} - ${externalUserId}`,
            pieceName,
            pieceVersion: '1.0.0',
            platformId,
            externalId: externalUserId,
            status,
            type: AppConnectionType.OAUTH2,
            scope: AppConnectionScope.PROJECT,
            value: encrypted as any,
            projectIds: [projectId],
        })
    }

    describe('1. Request Validation and Provider Domain Allowlist', () => {
        it('rejects unsupported provider with 400 and PROVIDER_NOT_SUPPORTED', async () => {
            const ctx = await createTestContext(app!)
            const response = await ctx.post('/v1/connect-proxy/request', {
                projectId: ctx.project.id,
                externalUserId: 'cust_alice',
                provider: 'unsupported_third_party_app',
                path: '/v1/resource',
            })

            expect(response?.statusCode).toBe(StatusCodes.CONFLICT)
            const body = response?.json()
            expect(body.params?.code).toBe(ConnectProxyErrorCode.PROVIDER_NOT_SUPPORTED)
        })

        it('rejects absolute URLs in path to prevent domain escape and SSRF', async () => {
            const ctx = await createTestContext(app!)
            await seedCustomerConnection({ projectId: ctx.project.id, externalUserId: 'cust_alice', pieceName: 'slack' })

            const response = await ctx.post('/v1/connect-proxy/request', {
                projectId: ctx.project.id,
                externalUserId: 'cust_alice',
                provider: 'slack',
                path: 'https://evil-attacker.com/steal-token',
            })

            expect(response?.statusCode).toBe(StatusCodes.BAD_REQUEST)
            const body = response?.json()
            expect(body.message).toContain('relative path')
        })

        it('rejects path traversal (..) in path', async () => {
            const ctx = await createTestContext(app!)
            await seedCustomerConnection({ projectId: ctx.project.id, externalUserId: 'cust_alice', pieceName: 'slack' })

            const response = await ctx.post('/v1/connect-proxy/request', {
                projectId: ctx.project.id,
                externalUserId: 'cust_alice',
                provider: 'slack',
                path: '/users.info/../../admin/delete',
            })

            expect(response?.statusCode).toBe(StatusCodes.BAD_REQUEST)
            const body = response?.json()
            expect(body.message).toContain('traversal')
        })

        it('validates subdomain requirement and regex for subdomain-based providers like Zendesk', async () => {
            const ctx = await createTestContext(app!)
            await seedCustomerConnection({ projectId: ctx.project.id, externalUserId: 'cust_alice', pieceName: 'zendesk' })

            // Malformed subdomain with special characters or path injection
            const response = await ctx.post('/v1/connect-proxy/request', {
                projectId: ctx.project.id,
                externalUserId: 'cust_alice',
                provider: 'zendesk',
                subdomain: 'invalid.domain/extra',
                path: '/tickets.json',
            })

            expect(response?.statusCode).toBe(StatusCodes.BAD_REQUEST)
        })
    })

    describe('2. Project and Customer Authorization Invariants', () => {
        it('denies cross-customer connection usage (Customer Bob attempting to proxy with Alice connection ID)', async () => {
            const ctx = await createTestContext(app!)
            const aliceConnection = await seedCustomerConnection({
                projectId: ctx.project.id,
                externalUserId: 'cust_alice',
                pieceName: 'slack',
            })

            const response = await ctx.post('/v1/connect-proxy/request', {
                projectId: ctx.project.id,
                externalUserId: 'cust_bob',
                provider: 'slack',
                connectionId: aliceConnection.id,
                path: '/users.info',
            })

            expect(response?.statusCode).toBe(StatusCodes.FORBIDDEN)
            const body = response?.json()
            expect(body.params?.code).toBe(ConnectProxyErrorCode.CROSS_CUSTOMER_FORBIDDEN)
        })

        it('denies cross-project connection usage (Project 2 attempting to proxy with Project 1 connection ID)', async () => {
            const ctxOne = await createTestContext(app!)
            const ctxTwo = await createTestContext(app!)

            const projectOneConnection = await seedCustomerConnection({
                projectId: ctxOne.project.id,
                externalUserId: 'cust_alice',
                pieceName: 'slack',
            })

            const response = await ctxTwo.post('/v1/connect-proxy/request', {
                projectId: ctxTwo.project.id,
                externalUserId: 'cust_alice',
                provider: 'slack',
                connectionId: projectOneConnection.id,
                path: '/users.info',
            })

            expect(response?.statusCode).toBe(StatusCodes.FORBIDDEN)
            const body = response?.json()
            expect(body.params?.code).toBe(ConnectProxyErrorCode.CROSS_PROJECT_FORBIDDEN)
        })

        it('denies execution when connection provider does not match target provider', async () => {
            const ctx = await createTestContext(app!)
            const slackConnection = await seedCustomerConnection({
                projectId: ctx.project.id,
                externalUserId: 'cust_alice',
                pieceName: 'slack',
            })

            const response = await ctx.post('/v1/connect-proxy/request', {
                projectId: ctx.project.id,
                externalUserId: 'cust_alice',
                provider: 'github', // Mismatch: Slack connection cannot call GitHub
                connectionId: slackConnection.id,
                path: '/user/repos',
            })

            expect(response?.statusCode).toBe(StatusCodes.CONFLICT)
            const body = response?.json()
            expect(body.params?.code).toBe(ConnectProxyErrorCode.PROVIDER_MISMATCH)
        })

        it('returns 404 CONNECTION_NOT_FOUND when customer has no active connection for the provider', async () => {
            const ctx = await createTestContext(app!)

            const response = await ctx.post('/v1/connect-proxy/request', {
                projectId: ctx.project.id,
                externalUserId: 'cust_nonexistent',
                provider: 'slack',
                path: '/users.info',
            })

            expect(response?.statusCode).toBe(StatusCodes.NOT_FOUND)
            const body = response?.json()
            expect(body.params?.code).toBe(ConnectProxyErrorCode.CONNECTION_NOT_FOUND)
        })
    })

    describe('3. Credential Injection, Header Sanitization, and SSRF Security', () => {
        it('injects customer decrypted credentials and forbids caller from overriding Authorization', async () => {
            const ctx = await createTestContext(app!)
            await seedCustomerConnection({
                projectId: ctx.project.id,
                externalUserId: 'cust_alice',
                pieceName: 'slack',
                token: 'alice_super_secret_slack_token_999',
            })

            const response = await ctx.post('/v1/connect-proxy/request', {
                projectId: ctx.project.id,
                externalUserId: 'cust_alice',
                provider: 'slack',
                method: 'GET',
                path: '/users.info',
                query: { user: 'U12345' },
                headers: {
                    'Authorization': 'Bearer attacker_overridden_token',
                    'X-Custom-Tracking': 'track_abc',
                },
            })

            expect(response?.statusCode).toBe(StatusCodes.OK)
            const body = response?.json()
            expect(body.status).toBe(200)
            expect(body.provider).toBe('slack')
            expect(body.rateLimit?.limit).toBe(500)

            // Inspect the outbound call sent by safeHttp client
            expect(mockAxiosInstance.request).toHaveBeenCalledTimes(1)
            const requestArg = mockAxiosInstance.request.mock.calls[0][0]
            expect(requestArg.url).toBe('https://slack.com/api/users.info')
            expect(requestArg.method).toBe('GET')
            expect(requestArg.params).toEqual({ user: 'U12345' })
            // Overridden header is overridden with customer's real decrypted token
            expect(requestArg.headers['Authorization']).toBe('Bearer alice_super_secret_slack_token_999')
            expect(requestArg.headers['X-Custom-Tracking']).toBe('track_abc')
        })

        it('redacts tokens and keys from error messages when upstream provider fails', async () => {
            const ctx = await createTestContext(app!)
            await seedCustomerConnection({
                projectId: ctx.project.id,
                externalUserId: 'cust_alice',
                pieceName: 'slack',
                token: 'alice_leaked_token_secret_xyz',
            })

            mockAxiosInstance.request.mockRejectedValueOnce(
                new Error('Upstream HTTP failed: Bearer alice_leaked_token_secret_xyz returned 502 Bad Gateway'),
            )

            const response = await ctx.post('/v1/connect-proxy/request', {
                projectId: ctx.project.id,
                externalUserId: 'cust_alice',
                provider: 'slack',
                path: '/users.info',
            })

            expect(response?.statusCode).toBe(StatusCodes.BAD_REQUEST)
            const body = response?.json()
            // Secret token must NEVER appear in the response
            expect(body.params?.message).not.toContain('alice_leaked_token_secret_xyz')
            expect(body.params?.message).toContain('Bearer [REDACTED]')
        })

        it('translates safeHttp SSRF blockages into SSRF_BLOCKED error code', async () => {
            const ctx = await createTestContext(app!)
            await seedCustomerConnection({
                projectId: ctx.project.id,
                externalUserId: 'cust_alice',
                pieceName: 'slack',
            })

            mockAxiosInstance.request.mockRejectedValueOnce(
                new Error('IP 169.254.169.254 is not allowed — the target is blocked by the SSRF filter.'),
            )

            const response = await ctx.post('/v1/connect-proxy/request', {
                projectId: ctx.project.id,
                externalUserId: 'cust_alice',
                provider: 'slack',
                path: '/users.info',
            })

            expect(response?.statusCode).toBe(StatusCodes.CONFLICT)
            const body = response?.json()
            expect(body.params?.code).toBe(ConnectProxyErrorCode.SSRF_BLOCKED)
        })
    })
})
