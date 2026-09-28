import dayjs from 'dayjs'
import { AnalyticsTimePeriod, PlatformAnalyticsReport } from '@inboxfm-connect/shared'
import { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { platformAnalyticsReportRepo } from '../../../../../src/app/analytics/platform-analytics-report.service'
import { databaseConnection } from '../../../../../src/app/database/database-connection'
import { createTestContext, TestContext } from '../../../helpers/test-context'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: FastifyInstance | null = null
let ctx: TestContext

beforeAll(async () => {
    app = await setupTestEnvironment({ fresh: true })
})

afterAll(async () => {
    await teardownTestEnvironment()
})

beforeEach(async () => {
    ctx = await createTestContext(app!)
    await databaseConnection().getRepository('platform_analytics_report').delete({ platformId: ctx.platform.id })
})

afterEach(async () => {
    vi.restoreAllMocks()
    await databaseConnection().getRepository('platform_analytics_report').delete({ platformId: ctx.platform.id })
})

describe('Platform Analytics Report lifecycle', () => {
    it('creates a new report on first refresh', async () => {
        const { platformAnalyticsReportService } = await import('../../../../../src/app/analytics/platform-analytics-report.service')
        
        const report = await platformAnalyticsReportService(ctx.log).refreshReport(ctx.platform.id)
        
        expect(report).toBeDefined()
        expect(report.platformId).toBe(ctx.platform.id)
        expect(report.outdated).toBe(false)
        expect(report.cachedAt).toBeDefined()
        expect(Array.isArray(report.runs)).toBe(true)
        expect(Array.isArray(report.flows)).toBe(true)
        expect(Array.isArray(report.users)).toBe(true)
    })

    it('updates existing report on subsequent refresh', async () => {
        const { platformAnalyticsReportService } = await import('../../../../../src/app/analytics/platform-analytics-report.service')
        
        const firstReport = await platformAnalyticsReportService(ctx.log).refreshReport(ctx.platform.id)
        const firstId = firstReport.id
        
        await new Promise(resolve => setTimeout(resolve, 10))
        
        const secondReport = await platformAnalyticsReportService(ctx.log).refreshReport(ctx.platform.id)
        
        expect(secondReport.id).toBe(firstId)
        expect(secondReport.cachedAt).not.toBe(firstReport.cachedAt)
    })

    it('marks report as outdated', async () => {
        const { platformAnalyticsReportService } = await import('../../../../../src/app/analytics/platform-analytics-report.service')
        
        await platformAnalyticsReportService(ctx.log).refreshReport(ctx.platform.id)
        await platformAnalyticsReportService(ctx.log).markAsOutdated(ctx.platform.id)
        
        const report = await platformAnalyticsReportRepo().findOneBy({ platformId: ctx.platform.id })
        expect(report?.outdated).toBe(true)
    })

    it('regenerates report when outdated', async () => {
        const { platformAnalyticsReportService } = await import('../../../../../src/app/analytics/platform-analytics-report.service')
        
        const firstReport = await platformAnalyticsReportService(ctx.log).refreshReport(ctx.platform.id)
        await platformAnalyticsReportService(ctx.log).markAsOutdated(ctx.platform.id)
        
        const regeneratedReport = await platformAnalyticsReportService(ctx.log).getOrGenerateReport(ctx.platform.id)
        
        expect(regeneratedReport.outdated).toBe(false)
        expect(regeneratedReport.cachedAt).not.toBe(firstReport.cachedAt)
    })

    it('regenerates report when cachedAt is older than 5 minutes', async () => {
        const { platformAnalyticsReportService } = await import('../../../../../src/app/analytics/platform-analytics-report.service')
        
        const firstReport = await platformAnalyticsReportService(ctx.log).refreshReport(ctx.platform.id)
        
        await databaseConnection().getRepository('platform_analytics_report').update(
            { platformId: ctx.platform.id },
            { cachedAt: dayjs().subtract(10, 'minute').toISOString() }
        )
        
        const regeneratedReport = await platformAnalyticsReportService(ctx.log).getOrGenerateReport(ctx.platform.id)
        
        expect(regeneratedReport.cachedAt).not.toBe(firstReport.cachedAt)
    })

    it('returns cached report when fresh and not outdated', async () => {
        const { platformAnalyticsReportService } = await import('../../../../../src/app/analytics/platform-analytics-report.service')
        
        const firstReport = await platformAnalyticsReportService(ctx.log).refreshReport(ctx.platform.id)
        const secondReport = await platformAnalyticsReportService(ctx.log).getOrGenerateReport(ctx.platform.id)
        
        expect(secondReport.id).toBe(firstReport.id)
        expect(secondReport.cachedAt).toBe(firstReport.cachedAt)
    })

    it('filters report by time period', async () => {
        const { platformAnalyticsReportService } = await import('../../../../../src/app/analytics/platform-analytics-report.service')
        
        await platformAnalyticsReportService(ctx.log).refreshReport(ctx.platform.id)
        
        const fullReport = await platformAnalyticsReportService(ctx.log).getOrGenerateReport(ctx.platform.id)
        const filteredReport = await platformAnalyticsReportService(ctx.log).getOrGenerateReport(
            ctx.platform.id, 
            AnalyticsTimePeriod.LAST_WEEK
        )
        
        expect(filteredReport.runs.length).toBeLessThanOrEqual(fullReport.runs.length)
    })

    it('enforces project scoping - reports isolated by platform', async () => {
        const { platformAnalyticsReportService } = await import('../../../../../src/app/analytics/platform-analytics-report.service')
        
        const { createTestContext } = await import('../../../helpers/test-context')
        const ctx2 = await createTestContext(app!)
        
        const report1 = await platformAnalyticsReportService(ctx.log).refreshReport(ctx.platform.id)
        const report2 = await platformAnalyticsReportService(ctx.log).refreshReport(ctx2.platform.id)
        
        expect(report1.platformId).toBe(ctx.platform.id)
        expect(report2.platformId).toBe(ctx2.platform.id)
        expect(report1.id).not.toBe(report2.id)
    })
})
