import jwt from 'jsonwebtoken'
import { describe, expect, it } from 'vitest'
import { generateWorkerTokenCommand } from '../../../src/lib/commands/generate-worker-token'

describe('Worker Token Generation CLI Command (Issue #139)', () => {
    it('registers token generation command properly', () => {
        expect(generateWorkerTokenCommand.name()).toBe('token')
        expect(generateWorkerTokenCommand.description()).toContain('Generate a JWT token for worker authentication')
    })

    it('generates a valid, verifiable worker JWT adhering to server contract', () => {
        const jwtSecret = 'test-super-secret-jwt-key-for-worker-auth-12345'
        const payload = {
            id: 'worker-node-123',
            type: 'WORKER',
        }
        const expiresIn = 100 * 365 * 24 * 60 * 60 // 100 years

        const token = jwt.sign(payload, jwtSecret, {
            expiresIn,
            keyid: '1',
            algorithm: 'HS256',
            issuer: 'activepieces',
        })

        expect(typeof token).toBe('string')
        expect(token.split('.')).toHaveLength(3)

        // Verify and decode token
        const decoded = jwt.verify(token, jwtSecret, {
            issuer: 'activepieces',
            algorithms: ['HS256'],
        }) as Record<string, unknown>

        expect(decoded.id).toBe('worker-node-123')
        expect(decoded.type).toBe('WORKER')
        expect(decoded.iss).toBe('activepieces')
        expect(decoded.exp).toBeDefined()
    })

    it('fails verification when an incorrect secret is provided', () => {
        const payload = { id: 'worker-1', type: 'WORKER' }
        const token = jwt.sign(payload, 'correct-secret', {
            expiresIn: 3600,
            issuer: 'activepieces',
        })

        expect(() =>
            jwt.verify(token, 'wrong-secret', {
                issuer: 'activepieces',
            }),
        ).toThrow()
    })
})
