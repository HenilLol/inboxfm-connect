import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'

// RED test (issue #415): the optional appName filter must COMPOSE with the
// projectId scoping (andWhere), not REPLACE it (TypeORM's second .where()
// resets expressionMap.wheres — SelectQueryBuilder.js:341), else
// ?appName= lists every tenant's app-credential rows.

const SERVICE = 'packages/server/api/src/app/ee/app-credentials/app-credentials.service.ts'

describe('app-credentials list WHERE composition (issue #415)', () => {
    const src = readFileSync(SERVICE, 'utf-8')

    it('the appName filter composes with the projectId scoping (andWhere, not where)', () => {
        // normalize whitespace so multi-line chains and comments don't break anchors
        const flat = src.replace(/\s+/g, ' ')
        expect(flat).toContain('.where({ projectId })')
        expect(flat).toContain('.andWhere({ appName })')
        expect(flat).not.toContain('queryBuilder.where({ appName })')
    })

    it('no second bare .where( exists after the projectId scoping inside list()', () => {
        // strip // comments so explanatory text mentioning .where() doesn't match
        const codeOnly = src.replace(/\/\/[^\n]*/g, '')
        const idx = codeOnly.indexOf('.where({ projectId })')
        expect(idx).toBeGreaterThan(-1)
        const after = codeOnly.slice(idx + 22).replace(/\s+/g, ' ')
        // the very next where-family call must be andWhere
        const nextWhere = after.match(/\.(andWhere|where)\(/)
        expect(nextWhere).not.toBeNull()
        expect(nextWhere![1]).toBe('andWhere')
    })
})
