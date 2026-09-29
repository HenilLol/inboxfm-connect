import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'

// RED test (issue #413): the DELETE /:connectionkeyId route must declare a
// security config (the module's other routes use securityAccess.project),
// and the service delete must be projectId-scoped — an id-only delete is
// cross-tenant on a route that (without config) is treated as PUBLIC by
// authentication-middleware + authorization-middleware.

const MODULE = 'packages/server/api/src/app/ee/connection-keys/connection-key.module.ts'
const SERVICE = 'packages/server/api/src/app/ee/connection-keys/connection-key.service.ts'

describe('connection-key DELETE security (issue #413)', () => {
    const moduleSrc = readFileSync(MODULE, 'utf-8')
    const serviceSrc = readFileSync(SERVICE, 'utf-8')

    it('the DELETE /:connectionkeyId route declares a security config', () => {
        // isolate the fastify.delete('/:connectionkeyId', ...) block
        const idx = moduleSrc.indexOf("fastify.delete(\n        '/:connectionkeyId'")
        expect(idx).toBeGreaterThan(-1)
        const block = moduleSrc.slice(idx, idx + 900)
        expect(block).toContain('security:')
        expect(block).toContain('securityAccess.project')
    })

    it('the route passes request.projectId into the service delete', () => {
        const idx = moduleSrc.indexOf("fastify.delete(\n        '/:connectionkeyId'")
        expect(idx).toBeGreaterThan(-1)
        const block = moduleSrc.slice(idx, idx + 1200)
        expect(block).toContain('projectId')
    })

    it('the service delete is projectId-scoped, not id-only', () => {
        const idx = serviceSrc.indexOf('async delete({ id, projectId }')
        expect(idx).toBeGreaterThan(-1)
        const block = serviceSrc.slice(idx, idx + 260)
        expect(block).toContain('projectId')
        expect(block).not.toMatch(/delete\(\{\s*id,\s*\}\)/)
    })
})
