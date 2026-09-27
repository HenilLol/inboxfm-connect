import { TriggerBinding, TriggerBindingStatus, TriggerHookType } from '@inboxfm-connect/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { executeEngineHook } from '../../../../src/app/execution/trigger-binding/trigger-binding.service'
import { system } from '../../../../src/app/helper/system/system'
import { AppSystemProp } from '../../../../src/app/helper/system/system-props'
import { userInteractionWatcher } from '../../../../src/app/helper/user-interaction/user-interaction-watcher'

const createSampleBinding = (id = 'tb_test_webhook_123'): TriggerBinding => ({
    id,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    projectId: 'proj_sample_123',
    platformId: 'plat_sample_123',
    pieceName: '@inboxfm-connect/piece-slack',
    pieceVersion: '0.1.0',
    triggerName: 'new_message',
    connectionId: 'conn_sample_123',
    promptTemplate: 'Handle message {{item.text}}',
    settings: {},
    propertySettings: null,
    status: TriggerBindingStatus.ENABLED,
})

describe('TriggerBinding Domain & Safety Audit', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
    })

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
        it('derives webhookUrl pointing to /run without localhost literals via executeEngineHook', async () => {
            const watcherSpy = vi.spyOn(userInteractionWatcher, 'submitAndWaitForResponse').mockResolvedValue({ output: [] } as never)
            const binding = createSampleBinding()

            await executeEngineHook({
                binding,
                hookType: TriggerHookType.ON_ENABLE,
            })

            expect(watcherSpy).toHaveBeenCalledTimes(1)
            const passedJobData = watcherSpy.mock.calls[0][0] as { webhookUrl: string }
            expect(passedJobData.webhookUrl).not.toContain('localhost:3000')
            expect(passedJobData.webhookUrl).toContain(`/api/v1/trigger-bindings/${binding.id}/run`)
            expect(passedJobData.webhookUrl.endsWith(`/api/v1/trigger-bindings/${binding.id}/run`)).toBe(true)
        })

        it('hands the exact same derived webhookUrl across ON_ENABLE, RUN, and RENEW hooks', async () => {
            const watcherSpy = vi.spyOn(userInteractionWatcher, 'submitAndWaitForResponse').mockResolvedValue({ output: [] } as never)
            const binding = createSampleBinding('tb_parity_check_456')

            await executeEngineHook({
                binding,
                hookType: TriggerHookType.ON_ENABLE,
            })
            await executeEngineHook({
                binding,
                hookType: TriggerHookType.RUN,
                triggerPayload: { event: 'ping' },
            })
            await executeEngineHook({
                binding,
                hookType: TriggerHookType.RENEW,
            })

            expect(watcherSpy).toHaveBeenCalledTimes(3)
            const onEnableJob = watcherSpy.mock.calls[0][0] as { webhookUrl: string }
            const runJob = watcherSpy.mock.calls[1][0] as { webhookUrl: string }
            const renewJob = watcherSpy.mock.calls[2][0] as { webhookUrl: string }

            expect(onEnableJob.webhookUrl).toContain(`/api/v1/trigger-bindings/${binding.id}/run`)
            expect(runJob.webhookUrl).toBe(onEnableJob.webhookUrl)
            expect(renewJob.webhookUrl).toBe(onEnableJob.webhookUrl)
        })

        it('rejects loudly and never emits a localhost URL when FRONTEND_URL is unset', async () => {
            const watcherSpy = vi.spyOn(userInteractionWatcher, 'submitAndWaitForResponse').mockResolvedValue({ output: [] } as never)
            const originalGetOrThrow = system.getOrThrow.bind(system)
            vi.spyOn(system, 'getOrThrow').mockImplementation((prop: string) => {
                if (prop === AppSystemProp.FRONTEND_URL) {
                    throw new Error('System property AP_FRONTEND_URL is not defined')
                }
                return originalGetOrThrow(prop as never)
            })

            const binding = createSampleBinding('tb_fail_loud_789')
            await expect(executeEngineHook({
                binding,
                hookType: TriggerHookType.ON_ENABLE,
            })).rejects.toThrow('System property AP_FRONTEND_URL is not defined')

            expect(watcherSpy).not.toHaveBeenCalled()
        })
    })
})
