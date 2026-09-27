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
                return pieceMetadataOperation.extract(operation as ExecuteExtractPieceMetadataOperation)
            }
            case EngineOperationType.EXECUTE_PROPERTY: {
                return propertyOperation.execute(operation as ExecutePropsOptions)
            }
            case EngineOperationType.EXECUTE_TRIGGER_HOOK: {
                return triggerHookOperation.execute(operation as ExecuteTriggerOperation<TriggerHookType>)
            }
            case EngineOperationType.EXECUTE_VALIDATE_AUTH: {
                return authValidationOperation.execute(operation as ExecuteValidateAuthOperation)
            }
            case EngineOperationType.EXECUTE_REFRESH_TOKEN_AUTH: {
                return authRefreshOperation.execute(operation as ExecuteRefreshTokenAuthOperation)
            }
            case EngineOperationType.EXECUTE_TOOL: {
                return pieceHelper.executeTool({
                    params: operation as ExecuteToolOperation,
                    devPieces: EngineConstants.DEV_PIECES,
                })
            }
            default: {
                throw new ExecutionError('Unsupported operation type', `Unsupported operation type: ${operationType}`, ExecutionErrorType.ENGINE)
            }
        }
    })
    if (result.error) {
        const isUserError = result.error instanceof ExecutionError && result.error.type === ExecutionErrorType.USER
        if (!isUserError) {
            console.error(result.error)
        }
        return {
            response: undefined,
            status: isUserError ? EngineResponseStatus.USER_FAILURE : EngineResponseStatus.INTERNAL_ERROR,
            error: JSON.stringify(formatPieceError(result.error, { raw: inspect(result.error) })),
        }
    }
    return result.data
}