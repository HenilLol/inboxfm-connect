import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cryptoUtils } from '@inboxfm-connect/server-utils'

const mockFindOneBy = vi.fn()
const mockSave = vi.fn()
const mockUpdate = vi.fn()
const mockExecute = vi.fn()

const mockQueryBuilder = {
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockReturnThis(),
    execute: mockExecute,
}

vi.mock('../../../../src/app/core/db/repo-factory', () => ({
    repoFactory: vi.fn(() => () => ({
        save: mockSave,
        findOneBy: mockFindOneBy,
        update: mockUpdate,
        createQueryBuilder: vi.fn(() => mockQueryBuilder),
    })),
}))

vi.mock('../../../../src/app/helper/jwt-utils', () => ({
    jwtUtils: {
        getJwtSecret: vi.fn().mockResolvedValue('mock-jwt-secret-for-testing-only-12345'),
        sign: vi.fn().mockResolvedValue('signed-mock-access-token'),
        decodeAndVerify: vi.fn(),
    },
    JwtAudience: {
        MCP_OAUTH_ACCESS: 'mcp-oauth-access',
    },
}))

vi.mock('../../../../src/app/mcp/oauth/mcp-oauth.pkce', () => ({
    mcpOAuthPkce: {
        verify: vi.fn().mockReturnValue(true),
    },
}))

import { mcpOAuthTokenService, OAuthTokenError } from '../../../../src/app/mcp/oauth/token/mcp-oauth-token.service'

describe('mcpOAuthTokenService — Refresh Token Rotation & Lineage Reuse Detection', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockSave.mockResolvedValue({})
        mockUpdate.mockResolvedValue({ affected: 1 })
        mockExecute.mockResolvedValue({ raw: [] })
    })

    it('rotates refresh token on refreshAccessToken and records previousRefreshToken', async () => {
        const initialRawRefreshToken = 'initial-raw-token-123'
        const initialHashed = cryptoUtils.hashSHA256(initialRawRefreshToken)

        mockExecute.mockResolvedValueOnce({
            raw: [
                {
                    id: 'tok_123',
                    refreshToken: initialHashed,
                    previousRefreshToken: null,
                    clientId: 'client_abc',
                    userId: 'user_123',
                    projectId: 'proj_123',
                    platformId: 'plat_123',
                    scopes: ['mcp'],
                    expiresAt: new Date(Date.now() + 100000).toISOString(),
                    revoked: false,
                },
            ],
        })

        const result = await mcpOAuthTokenService.refreshAccessToken({
            refreshToken: initialRawRefreshToken,
            clientId: 'client_abc',
        })

        expect(result.access_token).toBe('signed-mock-access-token')
        expect(result.token_type).toBe('Bearer')
        expect(result.refresh_token).toBeDefined()
        expect(typeof result.refresh_token).toBe('string')
        expect(result.refresh_token).not.toBe(initialRawRefreshToken)

        expect(mockQueryBuilder.set).toHaveBeenCalledWith(
            expect.objectContaining({
                previousRefreshToken: initialHashed,
                refreshToken: expect.any(String),
            }),
        )
    })

    it('detects token replay/reuse via previousRefreshToken and revokes the token family', async () => {
        const replayedRawRefreshToken = 'old-rotated-token-123'
        const replayedHashed = cryptoUtils.hashSHA256(replayedRawRefreshToken)

        // Claim fails (returns empty raw array because token was already rotated)
        mockExecute.mockResolvedValueOnce({ raw: [] })
        // Stale lookup by previousRefreshToken finds the record
        mockFindOneBy.mockResolvedValueOnce({
            id: 'tok_123',
            refreshToken: 'newly-rotated-hash',
            previousRefreshToken: replayedHashed,
            clientId: 'client_abc',
            revoked: false,
        })

        await expect(
            mcpOAuthTokenService.refreshAccessToken({
                refreshToken: replayedRawRefreshToken,
                clientId: 'client_abc',
            }),
        ).rejects.toThrow(OAuthTokenError)

        // Verify the family record was revoked
        expect(mockUpdate).toHaveBeenCalledWith(
            { id: 'tok_123' },
            { revoked: true },
        )
    })

    it('rejects unknown refresh tokens when not matching active or previous token', async () => {
        const unknownRawToken = 'completely-unknown-token'
        mockExecute.mockResolvedValueOnce({ raw: [] })
        mockFindOneBy.mockResolvedValueOnce(null)

        await expect(
            mcpOAuthTokenService.refreshAccessToken({
                refreshToken: unknownRawToken,
                clientId: 'client_abc',
            }),
        ).rejects.toThrow('Invalid or expired refresh token')
    })

    it('rejects refresh when client id does not match', async () => {
        const rawToken = 'valid-token-123'
        const hashed = cryptoUtils.hashSHA256(rawToken)

        mockExecute.mockResolvedValueOnce({
            raw: [
                {
                    id: 'tok_123',
                    refreshToken: hashed,
                    clientId: 'client_abc',
                    revoked: false,
                    expiresAt: new Date(Date.now() + 100000).toISOString(),
                },
            ],
        })

        await expect(
            mcpOAuthTokenService.refreshAccessToken({
                refreshToken: rawToken,
                clientId: 'different_client',
            }),
        ).rejects.toThrow('Client mismatch')
    })
})
