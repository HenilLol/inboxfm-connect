import { promisify } from 'node:util'
import { zstdCompress as zstdCompressCallback, zstdDecompress as zstdDecompressCallback } from 'node:zlib'
import { FileCompression, isZstdCompressed } from '@inboxfm-connect/shared'

const zstdCompress = promisify(zstdCompressCallback)
const zstdDecompress = promisify(zstdDecompressCallback)

// Defense-in-depth against decompression bombs (issue #360): zstd payloads compress
// extremely well (a 200MB zero buffer shrinks to ~6KB), and the file save path stores
// whatever compressed bytes arrive — so decompression on read must never trust the
// stored byte length. Cap the expanded output at the platform's max file size so a
// few KB of stored data cannot force a multi-GB allocation in the API process.
const MAX_DECOMPRESSED_SIZE_MB = 25
const MAX_DECOMPRESSED_SIZE_BYTES = MAX_DECOMPRESSED_SIZE_MB * 1024 * 1024

export const fileCompressor = {
    async compress({ data, compression }: Params): Promise<Buffer> {
        switch (compression) {
            case FileCompression.NONE:
                return data
            case FileCompression.ZSTD:
                return zstdCompress(data)
        }
    },

    async decompress({ data, compression }: Params): Promise<Buffer> {
        switch (compression) {
            case FileCompression.NONE:
                if (isZstdCompressed(data)) {
                    return zstdDecompress(data, { maxOutputLength: MAX_DECOMPRESSED_SIZE_BYTES })
                }
                return data
            case FileCompression.ZSTD:
                return zstdDecompress(data, { maxOutputLength: MAX_DECOMPRESSED_SIZE_BYTES })
        }
    },
}

type Params = {
    data: Buffer
    compression: FileCompression
}