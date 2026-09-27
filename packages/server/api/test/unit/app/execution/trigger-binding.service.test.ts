import { TriggerBinding, TriggerBindingStatus } from '@inboxfm-connect/shared'
import { describe, expect, it } from 'vitest'

describe('TriggerBinding Domain & Safety Audit', () => {
    describe('Forbidden Graph Fields Audit', () => {
        it('ensures TriggerBinding schema contains zero legacy workflow graph fields', () => {
            const keys = Object.keys(TriggerBinding.shape)
            const forbiddenKeys = [
                'flowId',
                'flowVersionId',
                'flowRunId',
                'stepName',
                'stepIndex',
                'nodeId',
                'routerPath',
                'loopIteration',
            ]

            for (const forbiddenKey of forbiddenKeys) {
                expect(keys).not.toContain(forbiddenKey)
            }
        })
    })

    describe('TriggerBinding Contract Validation', () => {
        it('parses valid TriggerBinding with ENABLED status', () => {
            const binding = {
                id: 'tb_12345678901234567',
                created: new Date().toISOString(),
                updated: new Date().toISOString(),
                projectId: 'proj_12345678901234567',
                platformId: 'plat_12345678901234567',
                pieceName: '@inboxfm-connect/piece-slack',
                pieceVersion: '0.1.0',
                triggerName: 'new_message',
                connectionId: 'conn_12345678901234567',
                promptTemplate: 'Summarize the Slack message: {{item.text}}',
                settings: {
                    channel: 'C123456',
                },
                status: TriggerBindingStatus.ENABLED,
            }

            const parsed = TriggerBinding.parse(binding)
            expect(parsed.id).toBe('tb_12345678901234567')
            expect(parsed.status).toBe(TriggerBindingStatus.ENABLED)
            expect(parsed.promptTemplate).toContain('Summarize')
        })

        it('parses valid TriggerBinding with DISABLED status', () => {
            const binding = {
                id: 'tb_98765432109876543',
                created: new Date().toISOString(),
                updated: new Date().toISOString(),
                projectId: 'proj_12345678901234567',
                platformId: 'plat_12345678901234567',
                pieceName: '@inboxfm-connect/piece-github',
                pieceVersion: '0.2.0',
                triggerName: 'new_issue',
                connectionId: null,
                promptTemplate: 'Handle new issue',
                settings: {
                    repo: 'inboxfm/connect',
                },
                status: TriggerBindingStatus.DISABLED,
            }

            const parsed = TriggerBinding.parse(binding)
            expect(parsed.status).toBe(TriggerBindingStatus.DISABLED)
            expect(parsed.connectionId).toBeNull()
        })
    })

    describe('Webhook URL Derivation (#159)', () => {
        it('derives webhook URL using domainHelper without hardcoded localhost', async () => {
            const domainHelper = (await import('../../../../src/app/helper/domain-helper')).domainHelper
            const bindingId = 'tb_test_webhook_123'
            const url = await domainHelper.getPublicApiUrl({
                path: `v1/trigger-bindings/${bindingId}/webhook`,
            })

            expect(url).toContain(`/api/v1/trigger-bindings/${bindingId}/webhook`)
            expect(url.endsWith(`/api/v1/trigger-bindings/${bindingId}/webhook`)).toBe(true)
        })
    })
})
