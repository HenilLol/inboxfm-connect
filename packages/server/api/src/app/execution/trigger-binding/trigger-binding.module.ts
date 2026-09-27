import { FastifyPluginAsync } from 'fastify'
import { triggerBindingController } from './trigger-binding.controller'
import { triggerBindingService } from './trigger-binding.service'

export const triggerBindingModule: FastifyPluginAsync = async (app) => {
    try {
        const { bindings } = await triggerBindingService.reRegisterEnabledSchedules({ log: app.log })
        app.log.info({ bindings }, '[triggerBindingModule] Re-registered enabled trigger bindings on boot')
    }
    catch (error) {
        app.log.error({ error }, '[triggerBindingModule] Failed to re-register trigger bindings on boot')
    }
    await app.register(triggerBindingController, { prefix: '/v1/trigger-bindings' })
}
