import {
    EngineResponse,
    EngineResponseStatus,
    ExecuteValidateAuthOperation,
    ExecuteValidateAuthResponse,
} from '@inboxfm-connect/shared'
import { EngineConstants } from '../handler/context/engine-constants'
import { pieceHelper } from '../helper/piece-helper'

export const authValidationOperation = {
    execute: async (operation: ExecuteValidateAuthOperation): Promise<EngineResponse<ExecuteValidateAuthResponse>> => {
        const output = await pieceHelper.executeValidateAuth({
            params: operation,
            devPieces: EngineConstants.DEV_PIECES,
        })

        return {
            status: EngineResponseStatus.OK,
            response: output,
        }
    },
}