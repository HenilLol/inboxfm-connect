import { formatPieceError } from '@inboxfm-connect/core-utils'
import {
    EngineOperationType,
    EngineResponseStatus,
    ExecuteToolOperation,
    ExecutionError,
    ExecutionErrorType,
    PropsValidationError,
} from '@inboxfm-connect/shared'
import { describe, expect, it, vi } from 'vitest'
import { pieceHelper } from '../../src/lib/helper/piece-helper'
import { execute } from '../../src/lib/operations'

describe('PropsValidationError (Issue #169)', () => {
    it('is an ExecutionError subclass with ExecutionErrorType.USER', () => {
        const error = new PropsValidationError({
            apiKey: ['Expected string, received: undefined'],
        })

        expect(error).toBeInstanceOf(Error)
        expect(error).toBeInstanceOf(ExecutionError)
        expect(error.type).toBe(ExecutionErrorType.USER)
        expect(error.name).toBe('PropsValidationError')
        expect(error.fieldErrors).toEqual({
            apiKey: ['Expected string, received: undefined'],
        })
    })

    it('formats human-readable messages for structured field errors', () => {
        const singleError = new PropsValidationError({
            apiKey: ['API key is required'],
        })
        expect(PropsValidationError.formatHumanReadable(singleError.fieldErrors)).toBe(
            'Property validation failed: apiKey: API key is required',
        )

        const multiError = new PropsValidationError({
            host: ['Host is required'],
            port: ['Port must be a number', 'Port must be positive'],
        })
        expect(PropsValidationError.formatHumanReadable(multiError.fieldErrors)).toBe(
            'Property validation failed: host: Host is required; port: Port must be a number, Port must be positive',
        )
    })

    it('formatPieceError extracts the human-readable prose message rather than raw JSON', () => {
        const error = new PropsValidationError({
            channel: ['Expected string, received: null'],
        })

        const formatted = formatPieceError(error)
        expect(formatted.message).toBe('Property validation failed: channel: Expected string, received: null')
        expect(formatted.message).not.toContain('{\n')
        expect(formatted.message).not.toContain('"channel":')
    })

    it('execute classifies USER-level ExecutionErrors as USER_FAILURE instead of INTERNAL_ERROR', async () => {
        vi.spyOn(pieceHelper, 'executeTool').mockRejectedValueOnce(
            new PropsValidationError({
                endpoint: ['Expected string, received: undefined'],
            }),
        )

        const operation: ExecuteToolOperation = {
            pieceName: 'test-piece',
            pieceVersion: '1.0.0',
            actionName: 'test_action',
            input: {},
            apiUrl: 'http://localhost:3000',
            engineToken: 'test-token',
            projectId: 'test-project',
        }

        const response = await execute(EngineOperationType.EXECUTE_TOOL, operation)

        expect(response.status).toBe(EngineResponseStatus.USER_FAILURE)
        expect(response.status).not.toBe(EngineResponseStatus.INTERNAL_ERROR)
        expect(response.error).toBeDefined()
        const parsed = JSON.parse(response.error as string)
        expect(parsed.message).toBe('Property validation failed: endpoint: Expected string, received: undefined')
    })
})
