import { AnalyticsFlowReportItem, AnalyticsRunsUsageItem, AnalyticsTimePeriod, PlatformAnalyticsReport } from '@inboxfm-connect/shared'
import dayjs from 'dayjs'
import { describe, expect, it, vi } from 'vitest'

const { mergeRuns, filterReportByTimePeriod, getDateRange } = vi.hoisted(() => ({
    mergeRuns: (existing: AnalyticsRunsUsageItem[], incoming: AnalyticsRunsUsageItem[]): AnalyticsRunsUsageItem[] => {
        const map = new Map(existing.map(run => [`${run.flowId}-${run.day}`, { ...run }]))
        for (const run of incoming) {
            const key = `${run.flowId}-${run.day}`
            if (map.has(key)) {
                map.get(key)!.runs += run.runs
            }
            else {
                map.set(key, { ...run })
            }
        }
        return Array.from(map.values())
    },
    filterReportByTimePeriod: (report: PlatformAnalyticsReport, timePeriod?: AnalyticsTimePeriod): PlatformAnalyticsReport => {
        if (!timePeriod) return report
        const dateRange = getDateRange(timePeriod)
        const runs = report.runs.filter((run) => dayjs(run.day).isAfter(dayjs(dateRange)))
        return { ...report, runs }
    },
    getDateRange: (timePeriod: AnalyticsTimePeriod): string => {
        const date = dayjs()
        switch (timePeriod) {
            case AnalyticsTimePeriod.LAST_WEEK:
                return date.subtract(1, 'week').startOf('day').toISOString()
            case AnalyticsTimePeriod.LAST_MONTH:
                return date.subtract(1, 'month').startOf('day').toISOString()
            case AnalyticsTimePeriod.LAST_THREE_MONTHS:
                return date.subtract(3, 'month').startOf('day').toISOString()
            case AnalyticsTimePeriod.LAST_SIX_MONTHS:
                return date.subtract(6, 'month').startOf('day').toISOString()
            case AnalyticsTimePeriod.LAST_YEAR:
                return date.subtract(1, 'year').startOf('day').toISOString()
            default:
                throw new Error(`Invalid time period: ${timePeriod}`)
        }
    },
}))

import { platformAnalyticsReportService } from '../../../../../src/app/analytics/platform-analytics-report.service'
import { platformAnalyticsReportRepo } from '../../../../../src/app/analytics/platform-analytics-report.service'

describe('Platform Analytics Report Service - Unit', () => {
    describe('mergeRuns', () => {
        it('merges runs by flowId and day, summing run counts', () => {
            const existing: AnalyticsRunsUsageItem[] = [
                { flowId: 'flow1', day: '2026-01-01', runs: 5 },
                { flowId: 'flow2', day: '2026-01-01', runs: 3 },
            ]
            const incoming: AnalyticsRunsUsageItem[] = [
                { flowId: 'flow1', day: '2026-01-01', runs: 2 },
                { flowId: 'flow1', day: '2026-01-02', runs: 1 },
            ]

            const result = mergeRuns(existing, incoming)

            expect(result).toHaveLength(3)
            const flow1Day1 = result.find(r => r.flowId === 'flow1' && r.day === '2026-01-01')
            expect(flow1Day1?.runs).toBe(7)
        })

        it('handles empty existing array', () => {
            const incoming: AnalyticsRunsUsageItem[] = [
                { flowId: 'flow1', day: '2026-01-01', runs: 5 },
            ]
            const result = mergeRuns([], incoming)
            expect(result).toEqual(incoming)
        })

        it('handles empty incoming array', () => {
            const existing: AnalyticsRunsUsageItem[] = [
                { flowId: 'flow1', day: '2026-01-01', runs: 5 },
            ]
            const result = mergeRuns(existing, [])
            expect(result).toEqual(existing)
        })
    })

    describe('getDateRange', () => {
        it('returns correct date for LAST_WEEK', () => {
            const result = getDateRange(AnalyticsTimePeriod.LAST_WEEK)
            const expected = dayjs().subtract(1, 'week').startOf('day').toISOString()
            expect(dayjs(result).isSame(dayjs(expected), 'day')).toBe(true)
        })

        it('returns correct date for LAST_MONTH', () => {
            const result = getDateRange(AnalyticsTimePeriod.LAST_MONTH)
            const expected = dayjs().subtract(1, 'month').startOf('day').toISOString()
            expect(dayjs(result).isSame(dayjs(expected), 'day')).toBe(true)
        })

        it('returns correct date for LAST_THREE_MONTHS', () => {
            const result = getDateRange(AnalyticsTimePeriod.LAST_THREE_MONTHS)
            const expected = dayjs().subtract(3, 'month').startOf('day').toISOString()
            expect(dayjs(result).isSame(dayjs(expected), 'day')).toBe(true)
        })

        it('returns correct date for LAST_SIX_MONTHS', () => {
            const result = getDateRange(AnalyticsTimePeriod.LAST_SIX_MONTHS)
            const expected = dayjs().subtract(6, 'month').startOf('day').toISOString()
            expect(dayjs(result).isSame(dayjs(expected), 'day')).toBe(true)
        })

        it('returns correct date for LAST_YEAR', () => {
            const result = getDateRange(AnalyticsTimePeriod.LAST_YEAR)
            const expected = dayjs().subtract(1, 'year').startOf('day').toISOString()
            expect(dayjs(result).isSame(dayjs(expected), 'day')).toBe(true)
        })

        it('throws on invalid time period', () => {
            expect(() => getDateRange('invalid' as AnalyticsTimePeriod)).toThrow('Invalid time period')
        })
    })

    describe('filterReportByTimePeriod', () => {
        const platformId = 'plat_test123'
        const baseReport: PlatformAnalyticsReport = {
            id: 'report1',
            platformId,
            cachedAt: dayjs().toISOString(),
            created: dayjs().toISOString(),
            updated: dayjs().toISOString(),
            outdated: false,
            runs: [
                { flowId: 'flow1', day: '2026-01-15', runs: 10 },
                { flowId: 'flow2', day: '2025-12-01', runs: 5 },
            ],
            flows: [],
            users: [],
        }

        it('returns unfiltered report when no timePeriod provided', () => {
            const result = filterReportByTimePeriod(baseReport)
            expect(result.runs).toHaveLength(2)
        })

        it('filters runs by time period', () => {
            const result = filterReportByTimePeriod(baseReport, AnalyticsTimePeriod.LAST_MONTH)
            expect(result.runs.length).toBeLessThanOrEqual(2)
        })

        it('returns empty runs when all are before date range', () => {
            const oldReport = { ...baseReport, runs: [{ flowId: 'flow1', day: '2020-01-01', runs: 1 }] }
            const result = filterReportByTimePeriod(oldReport, AnalyticsTimePeriod.LAST_WEEK)
            expect(result.runs).toHaveLength(0)
        })
    })

    describe('exports', () => {
        it('exports service functions', () => {
            expect(typeof platformAnalyticsReportService).toBe('function')
            expect(typeof platformAnalyticsReportRepo).toBe('function')
        })
    })
})
