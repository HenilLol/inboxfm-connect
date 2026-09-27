import { describe, expect, it } from 'vitest'
import { FlowActionType, PieceAction } from '../../../src/lib/flows/actions/action'
import { addActionUtils } from '../../../src/lib/flows/operations/add-action-util'

describe('addActionUtils.replaceOldStepNameWithNewOne (Issue #167)', () => {
    it('renames simple step references inside {{ }}', () => {
        const input = '{{ step_1.output.id }} and {{ step_1.output.name }}'
        const result = addActionUtils.replaceOldStepNameWithNewOne({
            input,
            oldStepName: 'step_1',
            newStepName: 'step_2',
        })
        expect(result).toBe('{{ step_2.output.id }} and {{ step_2.output.name }}')
    })

    it('correctly renames step references when expression contains nested braces or string literals with }}', () => {
        const input = "{{ steps.step_1.output + '}}' + steps.step_1.value }}"
        const result = addActionUtils.replaceOldStepNameWithNewOne({
            input,
            oldStepName: 'step_1',
            newStepName: 'step_2',
        })
        expect(result).toBe("{{ steps.step_2.output + '}}' + steps.step_2.value }}")
    })

    it('correctly handles object literals with nested braces inside {{ }}', () => {
        const input = '{{ { key: steps.step_1.val, suffix: "}}" } }}'
        const result = addActionUtils.replaceOldStepNameWithNewOne({
            input,
            oldStepName: 'step_1',
            newStepName: 'step_2',
        })
        expect(result).toBe('{{ { key: steps.step_2.val, suffix: "}}" } }}')
    })

    it('escapes regex special characters in step names without crashing or corrupting matches', () => {
        const input = '{{ step$1.output }}'
        const result = addActionUtils.replaceOldStepNameWithNewOne({
            input,
            oldStepName: 'step$1',
            newStepName: 'step$2',
        })
        expect(result).toBe('{{ step$2.output }}')
    })

    it('respects word boundaries so step_10 is not renamed when replacing step_1', () => {
        const input = '{{ step_10.output + step_1.output }}'
        const result = addActionUtils.replaceOldStepNameWithNewOne({
            input,
            oldStepName: 'step_1',
            newStepName: 'step_2',
        })
        expect(result).toBe('{{ step_10.output + step_2.output }}')
    })

    it('returns original input unchanged when no mustache tokens are present', () => {
        const input = 'plain string without any tokens step_1'
        const result = addActionUtils.replaceOldStepNameWithNewOne({
            input,
            oldStepName: 'step_1',
            newStepName: 'step_2',
        })
        expect(result).toBe('plain string without any tokens step_1')
    })

    it('properly clones a step and rewrites nested mustache expressions in its inputs', () => {
        const step: PieceAction = {
            name: 'step_1',
            displayName: 'HTTP Request',
            type: FlowActionType.PIECE,
            valid: true,
            lastUpdatedDate: '2026-09-27T00:00:00.000Z',
            settings: {
                pieceName: '@inboxfm-connect/piece-http',
                pieceVersion: '1.0.0',
                propertySettings: {},
                input: {
                    url: 'https://example.com/api',
                    body: "{{ steps.step_1.output + '}}' }}",
                    nested: {
                        field: '{{ steps.step_1.data }}',
                    },
                },
            },
        }

        const cloned = addActionUtils.clone(step, { step_1: 'step_2' })
        expect(cloned.name).toBe('step_2')
        expect(cloned.displayName).toBe('HTTP Request Copy')
        const input = (cloned as PieceAction).settings.input as Record<string, unknown>
        expect(input.body).toBe("{{ steps.step_2.output + '}}' }}")
        expect((input.nested as Record<string, unknown>).field).toBe('{{ steps.step_2.data }}')
    })
})
