import { ActivepiecesError, ErrorCode, isNil } from '@inboxfm-connect/core-utils'
import { FileType, FileLocation } from '@inboxfm-connect/shared'
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
                const tarball = await packDistToTarball({ distPath: resolution.distPath })
                return reply.header('content-type', 'application/gzip').send(tarball)
            }
        }
    })
}

// Scoped by platformId (not projectId) because piece archives are platform-level assets —
// one platform must never read another platform's private archive.
const readPlatformArchiveBytes = async ({ archiveId, platformId, log }: ReadPlatformArchiveBytesParams): Promise<Buffer> => {
    const file = await fileRepo().findOneBy({ id: archiveId, platformId, type: FileType.PACKAGE_ARCHIVE })
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
    const data = await fileCompressor.decompress({
        data: file.location === FileLocation.DB ? file.data : await s3Helper(log).getFile(file.s3Key!),
        compression: file.compression,
    })
    return data
}

type ReadPlatformArchiveBytesParams = {
    archiveId: string
    platformId: string
    log: FastifyBaseLogger
}
