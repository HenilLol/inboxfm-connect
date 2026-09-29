import { zstdCompress } from 'node:zlib'
import { promisify } from 'node:util'
import { FileCompression } from '@inboxfm-connect/shared'
import { describe, expect, it } from 'vitest'
import { fileCompressor } from '../../../src/app/file/file-compressor'

const compress = promisify(zstdCompress)

describe('file compressor decompression-bomb cap (#360)', () => {
    it('round-trips a normal zstd payload under the cap', async () => {
        const data = Buffer.from('hello world'.repeat(100))
        const compressed = await fileCompressor.compress({ data, compression: FileCompression.ZSTD })
        const decompressed = await fileCompressor.decompress({ data: compressed, compression: FileCompression.ZSTD })
        expect(decompressed.equals(data)).toBe(true)
    })

    it('refuses to expand a zstd bomb past the cap instead of allocating it', async () => {
        // 60MB of zeros compresses to a few KB; the cap is 25MB
        const bomb = Buffer.alloc(60 * 1024 * 1024, 0)
        const compressed = await compress(bomb)
        expect(compressed.length).toBeLessThan(100 * 1024)

        await expect(fileCompressor.decompress({ data: compressed, compression: FileCompression.ZSTD }))
            .rejects
            .toThrow()
    })

    it('also caps NONE-marked files that secretly carry zstd bytes', async () => {
        const bomb = Buffer.alloc(60 * 1024 * 1024, 0)
        const compressed = await compress(bomb)

        await expect(fileCompressor.decompress({ data: compressed, compression: FileCompression.NONE }))
            .rejects
            .toThrow()
    })
})
