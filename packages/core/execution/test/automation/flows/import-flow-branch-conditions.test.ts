import { formErrors } from '@inboxfm-connect/core-utils'
import { BranchExecutionType, BranchOperator, FlowActionType, RouterActionSettings, RouterActionSettingsWithValidation, RouterExecutionType } from '../../../src/lib/flows/actions/action'
import { AddBranchRequest, FlowOperationRequest, FlowOperationType, ImportFlowRequest } from '../../../src/lib/flows/operations/index'
import { FlowTriggerType } from '../../../src/lib/flows/triggers/trigger'

function buildRouterAction({ firstValue, secondValue }: {
    firstValue: string
    secondValue?: string
}) {
    return {
        name: 'router_1',
        valid: true,
        displayName: 'Router',
        lastUpdatedDate: '2026-01-01T00:00:00.000Z',
        type: FlowActionType.ROUTER,
        settings: {
            branches: [
                {
                    branchType: BranchExecutionType.CONDITION,
                    branchName: 'Branch 1',
                    conditions: [[{
                        firstValue,
                        ...(secondValue !== undefined ? { secondValue } : {}),
                        operator: BranchOperator.TEXT_CONTAINS,
                    }]],
                },
                {
                    branchType: BranchExecutionType.FALLBACK,
                    branchName: 'Otherwise',
                },
            ],
            executionType: RouterExecutionType.EXECUTE_FIRST_MATCH,
        },
        children: [null, null],
    }
}

function buildImportRequest({ firstValue, secondValue }: {
    firstValue: string
    secondValue?: string
}) {
    return {
        displayName: 'Imported flow',
        trigger: {
            name: 'trigger',
            valid: true,
            displayName: 'Trigger',
            lastUpdatedDate: '2026-01-01T00:00:00.000Z',
            type: FlowTriggerType.EMPTY,
            settings: {},
            nextAction: buildRouterAction({ firstValue, secondValue }),
        },
        schemaVersion: null,
        notes: null,
    }
}

describe('ImportFlowRequest branch condition validation (issue #168)', () => {
    it('accepts an import whose router conditions are non-empty', () => {
        const result = ImportFlowRequest.safeParse(buildImportRequest({ firstValue: '{{trigger.status}}', secondValue: 'active' }))
        expect(result.success).toBe(true)
    })

    it('rejects an import with an empty firstValue using an i18n-ready message', () => {
        const result = ImportFlowRequest.safeParse(buildImportRequest({ firstValue: '', secondValue: 'active' }))
        expect(result.success).toBe(false)
        if (result.success) {
            return
        }
        const messages = result.error.issues.map((issue) => issue.message)
        expect(messages).toContain(formErrors.required)
        const paths = result.error.issues.map((issue) => issue.path)
        expect(paths.some((path) => path[0] === 'trigger')).toBe(true)
    })

    it('rejects an import with an empty secondValue', () => {
        const result = ImportFlowRequest.safeParse(buildImportRequest({ firstValue: '{{trigger.status}}', secondValue: '' }))
        expect(result.success).toBe(false)
    })

    it('accepts an import with fallback-only branches', () => {
        const request = buildImportRequest({ firstValue: '{{trigger.status}}', secondValue: 'active' })
        request.trigger.nextAction.settings.branches = [{
            branchType: BranchExecutionType.FALLBACK,
            branchName: 'Otherwise',
        }]
        const result = ImportFlowRequest.safeParse(request)
        expect(result.success).toBe(true)
    })

    it('rejects empty conditions through the IMPORT_FLOW operation union', () => {
        const result = FlowOperationRequest.safeParse({
            type: FlowOperationType.IMPORT_FLOW,
            request: buildImportRequest({ firstValue: '', secondValue: 'active' }),
        })
        expect(result.success).toBe(false)
    })
})

describe('AddBranchRequest branch condition validation (issue #168)', () => {
    it('rejects empty branch conditions', () => {
        const result = AddBranchRequest.safeParse({
            branchIndex: 0,
            stepName: 'router_1',
            branchName: 'Branch 1',
            conditions: [[{ firstValue: '', secondValue: 'active', operator: BranchOperator.TEXT_CONTAINS }]],
        })
        expect(result.success).toBe(false)
    })

    it('accepts non-empty branch conditions', () => {
        const result = AddBranchRequest.safeParse({
            branchIndex: 0,
            stepName: 'router_1',
            branchName: 'Branch 1',
            conditions: [[{ firstValue: '{{trigger.status}}', secondValue: 'active', operator: BranchOperator.TEXT_CONTAINS }]],
        })
        expect(result.success).toBe(true)
    })
})

describe('RouterActionSettings strictness regression (issue #168)', () => {
    it('rejects empty conditions without the lax schema', () => {
        const settings = buildRouterAction({ firstValue: '', secondValue: 'active' }).settings
        expect(RouterActionSettings.safeParse(settings).success).toBe(false)
        expect(RouterActionSettingsWithValidation.safeParse(settings).success).toBe(false)
    })

    it('accepts non-empty conditions', () => {
        const settings = buildRouterAction({ firstValue: '{{trigger.status}}', secondValue: 'active' }).settings
        expect(RouterActionSettings.safeParse(settings).success).toBe(true)
        expect(RouterActionSettingsWithValidation.safeParse(settings).success).toBe(true)
    })
})
