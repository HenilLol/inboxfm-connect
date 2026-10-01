import { isNil, PlatformId, ProjectId } from '@inboxfm-connect/core-utils'
import { PropertyType } from '@inboxfm-connect/pieces-framework'
import { AppConnection, AppConnectionStatus, AppConnectionType, AppConnectionValue, EngineResponse, EngineResponseStatus, ExecuteRefreshTokenAuthResponse, WorkerJobType } from '@inboxfm-connect/shared'
import dayjs from 'dayjs'
import { FastifyBaseLogger } from 'fastify'
import { lru, LRU } from 'tiny-lru'
import { ArrayContains } from 'typeorm'
import { distributedLock } from '../../database/redis-connections'
import { encryptUtils } from '../../helper/encryption'
import { exceptionHandler } from '../../helper/exception-handler'
import { userInteractionWatcher } from '../../helper/user-interaction/user-interaction-watcher'
import { getPiecePackageWithoutArchive, pieceMetadataService } from '../../pieces/metadata/piece-metadata-service'
import { AppConnectionSchema } from '../app-connection.entity'
import { appConnectionsRepo } from './app-connection-service'
import { oauth2Handler } from './oauth2'
import { oauth2Util } from './oauth2/oauth2-util'

export const appConnectionHandler = (_log: FastifyBaseLogger) => ({

    async refresh(connection: AppConnection, projectId: ProjectId, log: FastifyBaseLogger): Promise<AppConnection> {
        switch (connection.value.type) {
            case AppConnectionType.PLATFORM_OAUTH2:
                connection.value = await oauth2Handler[connection.value.type](log).refresh({
                    pieceName: connection.pieceName,
                    platformId: connection.platformId,
                    projectId,
                    connectionValue: connection.value,
                })
                break
            case AppConnectionType.CLOUD_OAUTH2:
                connection.value = await oauth2Handler[connection.value.type](log).refresh({
                    pieceName: connection.pieceName,
                    platformId: connection.platformId,
                    projectId,
                    connectionValue: connection.value,
                })
                break
            case AppConnectionType.OAUTH2:
                connection.value = await oauth2Handler[connection.value.type](log).refresh({
                    pieceName: connection.pieceName,
                    platformId: connection.platformId,
                    projectId,
                    connectionValue: connection.value,
                })
                break
            case AppConnectionType.CUSTOM_AUTH: {
                const piece = await getPiecePackageWithoutArchive(log, connection.platformId, {
                    pieceName: connection.pieceName,
                    pieceVersion: connection.pieceVersion,
                })
                log.info({ pieceName: connection.pieceName, externalId: connection.externalId }, '[custom-auth-refresh] submitting token refresh job')
                const engineResponse = await userInteractionWatcher.submitAndWaitForResponse<EngineResponse<ExecuteRefreshTokenAuthResponse>>({
                    piece,
                    projectId,
                    platformId: connection.platformId,
                    auth: connection.value,
                    jobType: WorkerJobType.EXECUTE_TOKEN_REFRESH,
                }, log)
                if (engineResponse.status === EngineResponseStatus.TIMEOUT) {
                    log.warn({ pieceName: connection.pieceName }, '[custom-auth-refresh] token refresh timed out — using existing credentials')
                    return connection
                }
                if (engineResponse.status !== EngineResponseStatus.OK) {
                    throw new CustomAuthRefreshError(`Custom auth token refresh failed: ${engineResponse.error ?? 'unknown engine error'}`)
                }
                const refreshResult = engineResponse.response
                if (refreshResult.skipped) {
                    // Piece no longer has onRefreshToken (e.g. piece was updated) — clear
                    // the token so the next needRefresh call re-checks piece metadata.
                    log.info({ pieceName: connection.pieceName }, '[custom-auth-refresh] piece has no refresh callback — clearing stale token')
                    pieceRefreshSupportCache.set(pieceRefreshSupportCacheKey(connection), false)
                    connection.value = {
                        ...connection.value,
                        access_token: undefined,
                        token_refresh_at: undefined,
                    }
                }
                else {
                    log.info({ pieceName: connection.pieceName, expiresIn: refreshResult.expires_in }, '[custom-auth-refresh] token refreshed successfully')
                    connection.value = {
                        ...connection.value,
                        access_token: refreshResult.access_token,
                        token_refresh_at: computeTokenRefreshAt(refreshResult.expires_in),
                    }
                }
                break
            }
            default:
                break
        }
        return connection
    },

    /**
 * We should make sure this is accessed only once, as a race condition could occur where the token needs to be
 * refreshed and it gets accessed at the same time, which could result in the wrong request saving incorrect data.
 */
    async lockAndRefreshConnection({
        platformId,
        projectId,
        externalId,
        log,
    }: {
        platformId: PlatformId
        projectId: ProjectId
        externalId: string
        log: FastifyBaseLogger
    }) {

        return distributedLock(log).runExclusive({
            key: `${platformId}_${externalId}`,
            timeoutInSeconds: 60,
            fn: async () => {
                let appConnection: AppConnection | null = null

                try {
                    const encryptedAppConnection = await appConnectionsRepo().findOneBy({
                        projectIds: ArrayContains([projectId]),
                        externalId,
                    })
                    if (isNil(encryptedAppConnection)) {
                        return encryptedAppConnection
                    }
                    appConnection = await this.decryptConnection(encryptedAppConnection)
                    if (!await this.needRefresh(appConnection, log)) {
                        return appConnection
                    }
                    const refreshedAppConnection = await this.refresh(appConnection, projectId, log)
        
                    await appConnectionsRepo().update(refreshedAppConnection.id, {
                        status: AppConnectionStatus.ACTIVE,
                        value: await encryptUtils.encryptObject(refreshedAppConnection.value),
                    })
                    return refreshedAppConnection
                }
                catch (e) {
                    exceptionHandler.handle(e, log)
                    const isOAuth2Error = oauth2Util(log).isUserError(e)
                    const isCustomAuthError = e instanceof CustomAuthRefreshError
                    if (!isNil(appConnection) && (isOAuth2Error || isCustomAuthError)) {
                        appConnection.status = AppConnectionStatus.ERROR
                        await appConnectionsRepo().update(appConnection.id, {
                            status: appConnection.status,
                            updated: dayjs().toISOString(),
                        })
                    }
                }
                return appConnection
            },
        })
    },
    async decryptConnection(
        encryptedConnection: AppConnectionSchema,
    ): Promise<AppConnection> {
        const value = await encryptUtils.decryptObject<AppConnectionValue>(encryptedConnection.value)
        const connection: AppConnection = {
            ...encryptedConnection,
            value,
        }
        return connection
    },
    async needRefresh(connection: AppConnection, log: FastifyBaseLogger): Promise<boolean> {
        if (connection.status === AppConnectionStatus.ERROR) {
            return false
        }
        switch (connection.value.type) {
            case AppConnectionType.PLATFORM_OAUTH2:
            case AppConnectionType.CLOUD_OAUTH2:
            case AppConnectionType.OAUTH2:
                return oauth2Util(log).isExpired(connection.value)
            case AppConnectionType.CUSTOM_AUTH: {
                // Once a token exists, check expiry without a metadata lookup.
                if (!isNil(connection.value.access_token)) {
                    return isCustomAuthTokenStale(connection.value)
                }
                // No token yet — only dispatch a refresh job if the piece implements onRefreshToken.
                // Cache the result per piece version to avoid a metadata round-trip on every execution.
                const cacheKey = pieceRefreshSupportCacheKey(connection)
                const cached = pieceRefreshSupportCache.get(cacheKey)
                if (!isNil(cached)) {
                    return cached
                }
                const pieceMetadata = await pieceMetadataService(log).getOrThrow({
                    name: connection.pieceName,
                    version: connection.pieceVersion,
                    platformId: connection.platformId,
                })
                const auth = Array.isArray(pieceMetadata.auth) ? pieceMetadata.auth[0] : pieceMetadata.auth
                const hasRefresh = auth?.type === PropertyType.CUSTOM_AUTH && !isNil(auth.refresh)
                pieceRefreshSupportCache.set(cacheKey, hasRefresh)
                return hasRefresh
            }
            default:
                return false
        }
    },
})


const TOKEN_REFRESH_BUFFER_SECONDS = 15 * 60
const pieceRefreshSupportCache: LRU<boolean> = lru(1000, 0)

export function isCustomAuthTokenStale(value: { access_token?: string, token_refresh_at?: number }): boolean {
    if (isNil(value.access_token)) return true
    if (isNil(value.token_refresh_at)) return false
    return dayjs().unix() >= value.token_refresh_at
}

// Returns the unix timestamp at which the token should be refreshed: 15 minutes
// before expiry, but never earlier than half the token's lifetime — otherwise a
// token whose TTL is shorter than the buffer would be considered stale the instant
// it is minted, refreshing on every fetch and defeating the cache. `expiresIn <= 0`
// means the token never expires, so it never needs refreshing.
export function computeTokenRefreshAt(expiresIn: number): number | undefined {
    if (expiresIn <= 0) {
        return undefined
    }
    const buffer = Math.min(TOKEN_REFRESH_BUFFER_SECONDS, Math.floor(expiresIn / 2))
    return dayjs().unix() + expiresIn - buffer
}

function pieceRefreshSupportCacheKey(connection: Pick<AppConnection, 'platformId' | 'pieceName' | 'pieceVersion'>): string {
    return `${connection.platformId}:${connection.pieceName}@${connection.pieceVersion}`
}

class CustomAuthRefreshError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'CustomAuthRefreshError'
    }
}

