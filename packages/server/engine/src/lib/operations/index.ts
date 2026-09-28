import { inspect } from 'util'
import { formatPieceError, tryCatch } from '@inboxfm-connect/core-utils'
import { EngineOperation, EngineOperationType, EngineResponse, EngineResponseStatus, ExecuteExtractPieceMetadataOperation, ExecutePropsOptions, ExecuteRefreshTokenAuthOperation, ExecuteToolOperation, ExecuteTriggerOperation, ExecuteValidateAuthOperation, ExecutionError, ExecutionErrorType, TriggerHookType } from '@inboxfm-connect/shared'
import { EngineConstants } from '../handler/context/engine-constants'
import { pieceHelper } from '../helper/piece-helper'
import { authRefreshOperation } from './auth-refresh.operation'
import { authValidationOperation } from './auth-validation.operation'
import { pieceMetadataOperation } from './piece-metadata.operation'
import { propertyOperation } from './property.operation'
import { triggerHookOperation } from './trigger-hook.operation'

export async function execute(operationType: EngineOperationType, operation: EngineOperation): Promise<EngineResponse<unknown>> {
    const result = await tryCatch(async () => {
        switch (operationType) {
            case EngineOperationType.EXTRACT_PIECE_METADATA: {
                if (isExtractPieceMetadataOperation(operation)) {
                    return pieceMetadataOperation.extract(operation)
                }
                throw new ExecutionError('Invalid operation payload', 'Expected extract piece metadata payload', ExecutionErrorType.ENGINE)
            }
            case EngineOperationType.EXECUTE_PROPERTY: {
                if (isExecutePropsOptions(operation)) {
                    return propertyOperation.execute(operation)
                }
                throw new ExecutionError('Invalid operation payload', 'Expected execute property payload', ExecutionErrorType.ENGINE)
            }
            case EngineOperationType.EXECUTE_TRIGGER_HOOK: {
                if (isExecuteTriggerOperation(operation)) {
                    return triggerHookOperation.execute(operation)
                }
                throw new ExecutionError('Invalid operation payload', 'Expected execute trigger hook payload', ExecutionErrorType.ENGINE)
            }
            case EngineOperationType.EXECUTE_VALIDATE_AUTH: {
                if (isExecuteValidateAuthOperation(operation)) {
                    return authValidationOperation.execute(operation)
                }
                throw new ExecutionError('Invalid operation payload', 'Expected execute validate auth payload', ExecutionErrorType.ENGINE)
            }
            case EngineOperationType.EXECUTE_REFRESH_TOKEN_AUTH: {
                if (isExecuteRefreshTokenAuthOperation(operation)) {
                    return authRefreshOperation.execute(operation)
                }
                throw new ExecutionError('Invalid operation payload', 'Expected execute refresh token auth payload', ExecutionErrorType.ENGINE)
            }
            case EngineOperationType.EXECUTE_TOOL: {
                if (isExecuteToolOperation(operation)) {
                    return pieceHelper.executeTool({
                        params: operation,
                        devPieces: EngineConstants.DEV_PIECES,
                    })
                }
                throw new ExecutionError('Invalid operation payload', 'Expected execute tool payload', ExecutionErrorType.ENGINE)
            }
            default: {
                throw new ExecutionError('Unsupported operation type', `Unsupported operation type: ${operationType}`, ExecutionErrorType.ENGINE)
            }
        }
    })
    if (result.error) {
        console.error(result.error)
        const isUserError = result.error instanceof ExecutionError && result.error.type === ExecutionErrorType.USER
        return {
            response: undefined,
            status: isUserError ? EngineResponseStatus.USER_FAILURE : EngineResponseStatus.INTERNAL_ERROR,
            error: JSON.stringify(formatPieceError(result.error, { raw: inspect(result.error) })),
        }
    }
    return result.data
}

function isExtractPieceMetadataOperation(op: EngineOperation): op is ExecuteExtractPieceMetadataOperation {
    return typeof op === 'object' && op !== null && 'piece' in op && !('auth' in op) && !('propertyName' in op) && !('hookType' in op) && !('tool' in op)
}

function isExecutePropsOptions(op: EngineOperation): op is ExecutePropsOptions {
    return typeof op === 'object' && op !== null && 'propertyName' in op
}

function isExecuteTriggerOperation(op: EngineOperation): op is ExecuteTriggerOperation<TriggerHookType> {
    return typeof op === 'object' && op !== null && 'hookType' in op
}

function isExecuteValidateAuthOperation(op: EngineOperation): op is ExecuteValidateAuthOperation {
    return typeof op === 'object' && op !== null && 'auth' in op && 'piece' in op && !('tool' in op) && !('hookType' in op) && !('propertyName' in op)
}

function isExecuteRefreshTokenAuthOperation(op: EngineOperation): op is ExecuteRefreshTokenAuthOperation {
    return typeof op === 'object' && op !== null && 'auth' in op && 'piece' in op && !('tool' in op) && !('hookType' in op) && !('propertyName' in op)
}

function isExecuteToolOperation(op: EngineOperation): op is ExecuteToolOperation {
    return typeof op === 'object' && op !== null && ('tool' in op || 'actionName' in op)
}