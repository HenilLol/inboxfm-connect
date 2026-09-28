import {
    AddBranchRequest,
    BranchExecutionType,
    BranchOperator,
    FlowActionType,
    FlowTriggerType,
    ImportFlowRequest,
    RouterActionSettings,
    RouterExecutionType,
    ValidBranchCondition,
} from '../../src'
import { describe, expect, it } from 'vitest'

describe('Flow Import and Branch Condition Validation (Issue #168)', () => {
    describe('ValidBranchCondition schema', () => {
        it('accepts non-empty firstValue condition', () => {
            const result = ValidBranchCondition.safeParse({
                firstValue: 'status',
                secondValue: 'active',
                operator: BranchOperator.TEXT_EXACTLY_MATCHES,
                caseSensitive: false,
            })

            expect(result.success).toBe(true)
        })

        it('rejects empty firstValue condition', () => {
            const result = ValidBranchCondition.safeParse({
                firstValue: '',
                secondValue: 'active',
                operator: BranchOperator.TEXT_EXACTLY_MATCHES,
                caseSensitive: false,
            })

            expect(result.success).toBe(false)
        })
    })

    describe('RouterActionSettings schema', () => {
        it('rejects router branch with empty condition firstValue', () => {
            const invalidRouterSettings = {
                branches: [
                    {
                        branchType: BranchExecutionType.CONDITION,
                        branchName: 'Branch 1',
                        conditions: [
                            [
                                {
                                    firstValue: '',
                                    secondValue: 'val',
                                    operator: BranchOperator.TEXT_CONTAINS,
                                    caseSensitive: false,
                                },
                            ],
                        ],
                    },
                ],
                executionType: RouterExecutionType.EXECUTE_FIRST_MATCH,
            }

            const result = RouterActionSettings.safeParse(invalidRouterSettings)
            expect(result.success).toBe(false)
        })
    })

    describe('AddBranchRequest schema', () => {
        it('rejects add branch request with empty condition', () => {
            const result = AddBranchRequest.safeParse({
                branchIndex: 0,
                stepName: 'step_1',
                branchName: 'Branch 1',
                conditions: [
                    [
                        {
                            firstValue: '',
                            secondValue: '123',
                            operator: BranchOperator.TEXT_CONTAINS,
                            caseSensitive: false,
                        },
                    ],
                ],
            })

            expect(result.success).toBe(false)
        })
    })

    describe('ImportFlowRequest validation', () => {
        it('rejects imported flow carrying router with empty branch condition', () => {
            const importPayload = {
                displayName: 'Imported Flow',
                trigger: {
                    name: 'trigger_1',
                    displayName: 'Trigger',
                    type: FlowTriggerType.EMPTY,
                    valid: true,
                    lastUpdatedDate: '2026-01-01T00:00:00.000Z',
                    settings: {},
                    nextAction: {
                        name: 'step_1',
                        displayName: 'Router Step',
                        type: FlowActionType.ROUTER,
                        valid: true,
                        lastUpdatedDate: '2026-01-01T00:00:00.000Z',
                        settings: {
                            branches: [
                                {
                                    branchType: BranchExecutionType.CONDITION,
                                    branchName: 'Condition Branch',
                                    conditions: [
                                        [
                                            {
                                                firstValue: '',
                                                secondValue: 'test',
                                                operator: BranchOperator.TEXT_CONTAINS,
                                                caseSensitive: false,
                                            },
                                        ],
                                    ],
                                },
                            ],
                            executionType: RouterExecutionType.EXECUTE_FIRST_MATCH,
                        },
                        children: [null],
                    },
                },
                schemaVersion: null,
                notes: null,
            }

            const result = ImportFlowRequest.safeParse(importPayload)
            expect(result.success).toBe(false)
        })

        it('accepts imported flow carrying router with valid branch conditions', () => {
            const importPayload = {
                displayName: 'Imported Flow',
                trigger: {
                    name: 'trigger_1',
                    displayName: 'Trigger',
                    type: FlowTriggerType.EMPTY,
                    valid: true,
                    lastUpdatedDate: '2026-01-01T00:00:00.000Z',
                    settings: {},
                    nextAction: {
                        name: 'step_1',
                        displayName: 'Router Step',
                        type: FlowActionType.ROUTER,
                        valid: true,
                        lastUpdatedDate: '2026-01-01T00:00:00.000Z',
                        settings: {
                            branches: [
                                {
                                    branchType: BranchExecutionType.CONDITION,
                                    branchName: 'Condition Branch',
                                    conditions: [
                                        [
                                            {
                                                firstValue: '{{trigger.payload.status}}',
                                                secondValue: 'success',
                                                operator: BranchOperator.TEXT_EXACTLY_MATCHES,
                                                caseSensitive: false,
                                            },
                                        ],
                                    ],
                                },
                            ],
                            executionType: RouterExecutionType.EXECUTE_FIRST_MATCH,
                        },
                        children: [null],
                    },
                },
                schemaVersion: null,
                notes: null,
            }

            const result = ImportFlowRequest.safeParse(importPayload)
            expect(result.success).toBe(true)
        })
    })
})
