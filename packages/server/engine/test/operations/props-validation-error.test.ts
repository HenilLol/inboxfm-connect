import {
    EngineOperationType,
    EngineResponseStatus,
    ExecutionErrorType,
    PropsValidationError,
} from '@inboxfm-connect/shared'
import { describe, expect, it, vi } from 'vitest'
import { execute } from '../../src/lib/operations'

describe('PropsValidationError & Error Classification', () => {
    describe('PropsValidationError structure', () => {
        it('constructs with structured errors and USER type', () => {
            const rawErrors = {
                channel: ['Expected string, received: 123'],
                message: ['Expected string, received: undefined'],
            }
            const error = new PropsValidationError(rawErrors)

            expect(error.name).toBe('PropsValidationError')
            expect(error.type).toBe(ExecutionErrorType.USER)
            expect(error.errors).toEqual(rawErrors)
            expect(error.message).toContain('Validation failed: channel: Expected string, received: 123; message: Expected string, received: undefined')
        })

        it('handles object errors with message property', () => {
            const rawErrors = {
                auth: { message: 'Authentication is required' },
            }
            const error = new PropsValidationError(rawErrors)

            expect(error.message).toContain('Validation failed: auth: Authentication is required')
            expect(error.type).toBe(ExecutionErrorType.USER)
        })
    })

    describe('execute operation classification', () => {
        it('classifies USER ExecutionError as USER_FAILURE status', async () => {
            const { pieceHelper } = await import('../../src/lib/helper/piece-helper')
            const spy = vi.spyOn(pieceHelper, 'executeTool').mockRejectedValueOnce(
                new PropsValidationError({ channel: ['Expected string, received: undefined'] }),
            )

            const mockOperation = {
                pieceName: '@inboxfm-connect/piece-slack',
                pieceVersion: '0.1.0',
                actionName: 'send_message',
                input: {},
                projectId: 'proj-1',
                platformId: 'plat-1',
                engineToken: 'token',
                internalApiUrl: 'http://localhost:3000',
                publicApiUrl: 'http://localhost:3000',
                timeoutInSeconds: 30,
            }

            const response = await execute(EngineOperationType.EXECUTE_TOOL, mockOperation as never)
            expect(response.status).toBe(EngineResponseStatus.USER_FAILURE)
            expect(response.error).toBeDefined()
            const parsedError = JSON.parse(response.error ?? '{}')
            expect(parsedError.__apErrorVersion).toBe(1)
            expect(parsedError.message).toContain('Validation failed: channel: Expected string, received: undefined')
            expect(parsedError.message).not.toContain('{\n  "')
            spy.mockRestore()
        })
    })
})
