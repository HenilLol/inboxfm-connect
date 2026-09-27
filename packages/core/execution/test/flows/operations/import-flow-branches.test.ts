import { describe, expect, it } from 'vitest'
import { ActivepiecesError, ErrorCode } from '@inboxfm-connect/core-utils'
import {
    BranchCondition,
    BranchExecutionType,
    BranchOperator,
    FlowActionType,
    RouterAction,
    RouterExecutionType,
    ValidBranchCondition,
} from '../../../src/lib/flows/actions/action'
import { FlowVersion, FlowVersionState } from '../../../src/lib/flows/flow-version'
import { AddBranchRequest, FlowOperationType, flowOperations, ImportFlowRequest } from '../../../src/lib/flows/operations'
import { FlowTriggerType } from '../../../src/lib/flows/triggers/trigger'

describe('BranchCondition and Flow Import Branch Validation (Issue #168)', () => {
    const mockFlowVersion: FlowVersion = {
        id: 'flow-version-1',
        created: '2026-09-27T00:00:00.000Z',
        updated: '2026-09-27T00:00:00.000Z',
        flowId: 'flow-1',
        displayName: 'Original Flow',
        valid: true,
        state: FlowVersionState.DRAFT,
        schemaVersion: '22',
        updatedBy: null,
        agentIds: [],
        connectionIds: [],
        backupFiles: null,
        notes: [],
        trigger: {
            name: 'trigger',
            displayName: 'Select a Trigger',
            type: FlowTriggerType.EMPTY,
            valid: true,
            lastUpdatedDate: '2026-09-27T00:00:00.000Z',
            settings: {},
        },
    }

    it('BranchCondition schema rejects empty condition values via ValidBranchCondition', () => {
        const emptyCondition = {
            firstValue: '',
            secondValue: 'expected_val',
            operator: BranchOperator.TEXT_CONTAINS,
        }
        const parseResult = ValidBranchCondition.safeParse(emptyCondition)
        expect(parseResult.success).toBe(false)

        const deprecatedResult = BranchCondition.safeParse(emptyCondition)
        expect(deprecatedResult.success).toBe(false)
    })

    it('ValidBranchCondition accepts valid non-empty condition values', () => {
        const validCondition = {
            firstValue: '{{ steps.trigger.body.status }}',
            secondValue: 'active',
            operator: BranchOperator.TEXT_EXACTLY_MATCHES,
        }
        const parseResult = ValidBranchCondition.safeParse(validCondition)
        expect(parseResult.success).toBe(true)
    })

    it('AddBranchRequest validates conditions with ValidBranchCondition', () => {
        const validRequest = {
            stepName: 'step_router',
            branchIndex: 0,
            branchName: 'Branch 1',
            conditions: [
                [
                    {
                        firstValue: 'status',
                        secondValue: 'success',
                        operator: BranchOperator.TEXT_CONTAINS,
                    },
                ],
            ],
        }
        expect(AddBranchRequest.safeParse(validRequest).success).toBe(true)

        const invalidRequest = {
            stepName: 'step_router',
            branchIndex: 0,
            branchName: 'Branch 1',
            conditions: [
                [
                    {
                        firstValue: '',
                        secondValue: 'success',
                        operator: BranchOperator.TEXT_CONTAINS,
                    },
                ],
            ],
        }
        expect(AddBranchRequest.safeParse(invalidRequest).success).toBe(false)
    })

    it('IMPORT_FLOW throws ActivepiecesError when an imported router contains empty conditions', () => {
        const invalidRouterAction: RouterAction = {
            name: 'step_router',
            displayName: 'Router Step',
            type: FlowActionType.ROUTER,
            valid: true,
            lastUpdatedDate: '2026-09-27T00:00:00.000Z',
            settings: {
                executionType: RouterExecutionType.EXECUTE_FIRST_MATCH,
                branches: [
                    {
                        branchType: BranchExecutionType.CONDITION,
                        branchName: 'Empty Condition Branch',
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
            },
            children: [null],
        }

        const importRequest: ImportFlowRequest = {
            displayName: 'Imported Flow with Empty Conditions',
            schemaVersion: '22',
            notes: null,
            trigger: {
                name: 'trigger',
                displayName: 'Select a Trigger',
                type: FlowTriggerType.EMPTY,
                valid: true,
                lastUpdatedDate: '2026-09-27T00:00:00.000Z',
                settings: {},
                nextAction: invalidRouterAction,
            },
        }

        expect(() =>
            flowOperations.apply(mockFlowVersion, {
                type: FlowOperationType.IMPORT_FLOW,
                request: importRequest,
            }),
        ).toThrowError(ActivepiecesError)

        try {
            flowOperations.apply(mockFlowVersion, {
                type: FlowOperationType.IMPORT_FLOW,
                request: importRequest,
            })
        }
        catch (err) {
            expect(err).toBeInstanceOf(ActivepiecesError)
            const apErr = err as ActivepiecesError
            expect(apErr.error.code).toBe(ErrorCode.FLOW_OPERATION_INVALID)
            expect(apErr.error.params.message).toContain('condition values must not be empty')
        }
    })

    it('IMPORT_FLOW successfully imports a flow when router conditions are valid', () => {
        const validRouterAction: RouterAction = {
            name: 'step_router',
            displayName: 'Router Step',
            type: FlowActionType.ROUTER,
            valid: true,
            lastUpdatedDate: '2026-09-27T00:00:00.000Z',
            settings: {
                executionType: RouterExecutionType.EXECUTE_FIRST_MATCH,
                branches: [
                    {
                        branchType: BranchExecutionType.CONDITION,
                        branchName: 'Valid Branch',
                        conditions: [
                            [
                                {
                                    firstValue: '{{ steps.trigger.data }}',
                                    secondValue: 'expected',
                                    operator: BranchOperator.TEXT_CONTAINS,
                                    caseSensitive: false,
                                },
                            ],
                        ],
                    },
                ],
            },
            children: [null],
        }

        const importRequest: ImportFlowRequest = {
            displayName: 'Valid Imported Flow',
            schemaVersion: '22',
            notes: null,
            trigger: {
                name: 'trigger',
                displayName: 'Select a Trigger',
                type: FlowTriggerType.EMPTY,
                valid: true,
                lastUpdatedDate: '2026-09-27T00:00:00.000Z',
                settings: {},
                nextAction: validRouterAction,
            },
        }

        const updated = flowOperations.apply(mockFlowVersion, {
            type: FlowOperationType.IMPORT_FLOW,
            request: importRequest,
        })

        expect(updated.displayName).toBe('Valid Imported Flow')
        expect(updated.trigger.nextAction?.name).toBe('step_router')
    })
})
