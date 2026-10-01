import { ActivepiecesError, ErrorCode, isNil } from '@inboxfm-connect/core-utils'
import { FileLocation, FileType } from '@inboxfm-connect/shared'
import { FastifyBaseLogger } from 'fastify'
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { StatusCodes } from 'http-status-codes'
import { z } from 'zod'
import { securityAccess } from '../core/security/authorization/fastify-security'
import { fileCompressor } from '../file/file-compressor'
import { fileRepo } from '../file/file.service'
import { s3Helper } from '../file/s3-helper'
import { packDistToTarball } from './dist-tarball'
import { pieceBundle } from './piece-bundle'

// Restores the engine-internal tarball-fetch surface that was dropped in the migration (#440):
// the sandbox pool downloads every non-dev piece bundle from this URL on connection validation,
// piece metadata extraction and flow execution. Contract: 401 for non-engine tokens, 307 redirect
// for registry-resolvable pieces, 200 + tgz bytes for platform-scoped archives and locally built
// dists, 404 otherwise.
export const pieceBundleController: FastifyPluginAsyncZod = async (fastify) => {
    fastify.get('/bundle', {
        config: {
            security: securityAccess.engine(),
        },
        schema: {
            querystring: z.object({
                name: z.string().optional(),
                version: z.string().optional(),
                archiveId: z.string().optional(),
            }),
        },
    }, async (req, reply) => {
        const resolution = await pieceBundle(req.log).resolve({
            name: req.query.name,
            version: req.query.version,
            archiveId: req.query.archiveId,
            platformId: req.principal.platform.id,
            projectId: req.principal.projectId,
        })
        switch (resolution.type) {
            case 'not-found':
                return reply.code(StatusCodes.NOT_FOUND).send()
            case 'redirect':
                return reply.code(StatusCodes.TEMPORARY_REDIRECT).header('location', resolution.url).send()
            case 'stream': {
                const data = await readPlatformArchiveBytes({
                    archiveId: resolution.archiveId,
                    platformId: req.principal.platform.id,
                    log: req.log,
                })
                return reply.header('content-type', 'application/gzip').send(data)
            }
            case 'local-dist': {
                const cacheKey = resolution.distPath
                let tarball = getCachedTarball(cacheKey)
                if (isNil(tarball)) {
                    tarball = await packDistToTarball({ distPath: resolution.distPath })
                    setCachedTarball(cacheKey, tarball)
                }
                return reply.header('content-type', 'application/gzip').send(tarball)
            }
        }
    })
}

const MAX_LOCAL_PIECE_CACHE_ENTRIES = 50
const localPieceTarballCache = new Map<string, Buffer>()

function getCachedTarball(key: string): Buffer | undefined {
    const cached = localPieceTarballCache.get(key)
    if (!isNil(cached)) {
        localPieceTarballCache.delete(key)
        localPieceTarballCache.set(key, cached)
    }
    return cached
}

function setCachedTarball(key: string, data: Buffer): void {
    if (localPieceTarballCache.has(key)) {
        localPieceTarballCache.delete(key)
    }
    else if (localPieceTarballCache.size >= MAX_LOCAL_PIECE_CACHE_ENTRIES) {
        const oldestKey = localPieceTarballCache.keys().next().value
        if (typeof oldestKey === 'string') {
            localPieceTarballCache.delete(oldestKey)
        }
    }
    localPieceTarballCache.set(key, data)
}

// Scoped by platformId (not projectId) because piece archives are platform-level assets —
// one platform must never read another platform's private archive.
const readPlatformArchiveBytes = async ({
    archiveId,
    platformId,
    log,
}: ReadPlatformArchiveBytesParams): Promise<Buffer> => {
    const file = await fileRepo().findOneBy({
        id: archiveId,
        platformId,
        type: FileType.PACKAGE_ARCHIVE,
    })
    if (isNil(file)) {
        throw new ActivepiecesError({
            code: ErrorCode.ENTITY_NOT_FOUND,
            params: {
                entityType: 'file',
                entityId: archiveId,
                message: 'File not found',
            },
        })
    }
    let rawData: Buffer
    if (file.location === FileLocation.DB) {
        rawData = file.data
    }
    else {
        const s3Key = file.s3Key
        if (isNil(s3Key)) {
            throw new ActivepiecesError({
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: {
                    entityType: 'file',
                    entityId: archiveId,
                    message: 'File S3 key not found',
                },
            })
        }
        rawData = await s3Helper(log).getFile(s3Key)
    }
    const data = await fileCompressor.decompress({
        data: rawData,
        compression: file.compression,
    })
    return data
}

type ReadPlatformArchiveBytesParams = {
    archiveId: string
    platformId: string
    log: FastifyBaseLogger
}
