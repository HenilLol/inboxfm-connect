import { describe, expect, it, vi } from 'vitest'

vi.mock('node:child_process', () => ({
    exec: vi.fn((cmd, opts, cb) => cb(null, { stdout: 'output', stderr: '' })),
}))

vi.mock('node:util', () => ({
    promisify: vi.fn((fn) => fn),
}))

import { exec } from '../src/lib/utils/exec'

describe('CLI utils - exec', () => {
    it('exports promisified exec', async () => {
        // This tests that the module exports the promisified exec function
        expect(typeof exec).toBe('function')
    })
})
