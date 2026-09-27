import RateLimitPlugin, { RateLimitOptions } from '@fastify/rate-limit'
import FastifyPlugin from 'fastify-plugin'
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { redisConnections } from '../../database/redis-connections'
import { networkUtils } from '../../helper/network-utils'
import { system } from '../../helper/system/system'
import { AppSystemProp } from '../../helper/system/system-props'

const API_RATE_LIMIT_AUTHN_ENABLED = system.getBoolean(
    AppSystemProp.API_RATE_LIMIT_AUTHN_ENABLED,
)

const API_RATE_LIMIT_SYNC_ENABLED = system.getBoolean(
    AppSystemProp.API_RATE_LIMIT_SYNC_ENABLED,
)

export const rateLimitModule: FastifyPluginAsyncZod = FastifyPlugin(
    async (app) => {
        if (API_RATE_LIMIT_AUTHN_ENABLED || API_RATE_LIMIT_SYNC_ENABLED) {
            await app.register(RateLimitPlugin, {
                global: false,
                keyGenerator: (req) => networkUtils.extractClientRealIp(req, system.get(AppSystemProp.CLIENT_REAL_IP_HEADER)),
                redis: await redisConnections.create(),
            })
        }
    },
)

// Tighter, IP-scoped tier for the routes an attacker would actually script against
// (sign-up, sign-in, password-reset request/confirm) — lower than the general AUTHN
// tier above, which also covers the already-authenticated switch-platform route.
// Shared across authentication.controller.ts, otp-controller.ts, and
// enterprise-local-authn-controller.ts so the limit is defined once. Registering
// this `config.rateLimit` on a route has no effect when the plugin above isn't
// registered (AP_API_RATE_LIMIT_AUTHN_ENABLED=false), same as the general tier.
export const authAbuseRateLimitOptions: RateLimitOptions = {
    max: Number.parseInt(
        system.getOrThrow(AppSystemProp.API_RATE_LIMIT_AUTHN_ABUSE_MAX),
        10,
    ),
    timeWindow: system.getOrThrow(AppSystemProp.API_RATE_LIMIT_AUTHN_ABUSE_WINDOW),
}

export const syncExecutionRateLimitOptions: RateLimitOptions = {
    max: Number.parseInt(
        system.getOrThrow(AppSystemProp.API_RATE_LIMIT_SYNC_MAX),
        10,
    ),
    timeWindow: system.getOrThrow(AppSystemProp.API_RATE_LIMIT_SYNC_WINDOW),
}
