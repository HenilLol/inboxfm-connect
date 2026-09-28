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

    describe('TriggerBinding Webhook URL Generation', () => {
        it('resolves webhook url with /api/v1/trigger-bindings/:id/webhook using domainHelper', async () => {
            const { domainHelper } = await import('../../../../src/app/helper/domain-helper')
            const { system } = await import('../../../../src/app/helper/system/system')
            const { AppSystemProp } = await import('../../../../src/app/helper/system/system-props')

            const originalFrontendUrl = system.get(AppSystemProp.FRONTEND_URL)
            try {
                process.env.AP_FRONTEND_URL = 'https://cloud.inboxfm-connect.com'
                const bindingId = 'tb_test123456789'
                const webhookUrl = await domainHelper.getPublicApiUrl({
                    path: `v1/trigger-bindings/${bindingId}/webhook`,
                })

                expect(webhookUrl).toBe(`https://cloud.inboxfm-connect.com/api/v1/trigger-bindings/${bindingId}/webhook`)
                expect(webhookUrl).not.toContain('localhost')
            }
            finally {
                if (originalFrontendUrl !== undefined) {
                    process.env.AP_FRONTEND_URL = originalFrontendUrl
                }
            }
        })
    })
})

