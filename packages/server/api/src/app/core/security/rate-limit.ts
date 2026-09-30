import RateLimitPlugin, { RateLimitOptions } from '@fastify/rate-limit'
import FastifyPlugin from 'fastify-plugin'
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { redisConnections } from '../../database/redis-connections'
import { networkUtils } from '../../helper/network-utils'
import { system } from '../../helper/system/system'
import { AppSystemProp } from '../../helper/system/system-props'
export const rateLimitModule: FastifyPluginAsyncZod = FastifyPlugin(
    async (app) => {
        if (
            system.getBoolean(AppSystemProp.API_RATE_LIMIT_AUTHN_ENABLED) ||
            system.getBoolean(AppSystemProp.API_RATE_LIMIT_SYNC_ENABLED)
        ) {
            await app.register(RateLimitPlugin, {
                global: false,
                keyGenerator: (req) =>
                    networkUtils.extractClientRealIp(req, system.get(AppSystemProp.CLIENT_REAL_IP_HEADER)) || req.ip,
                redis: await redisConnections.create(),
            })
        }
    },
)

// Tighter, IP-scoped tier for the routes an attacker would actually script against
// (sign-up, sign-in, password-reset request/confirm) — lower than the general AUTHN
// tier above, which also covers the already-authenticated switch-platform route.
// Shared across authentication.controller.ts, otp-controller.ts, and
// enterprise-local-authn-controller.ts so the limit is defined once.
// Gated dynamically via allowList on API_RATE_LIMIT_AUTHN_ENABLED.
export const authAbuseRateLimitOptions: RateLimitOptions = {
    allowList: () => !system.getBoolean(AppSystemProp.API_RATE_LIMIT_AUTHN_ENABLED),
    max: () => Number.parseInt(
        system.getOrThrow(AppSystemProp.API_RATE_LIMIT_AUTHN_ABUSE_MAX),
        10,
    ),
    timeWindow: system.getOrThrow(AppSystemProp.API_RATE_LIMIT_AUTHN_ABUSE_WINDOW),
}

// IP-scoped rate-limit tier for synchronous execution and AI-provider routes.
// Gated dynamically via allowList on API_RATE_LIMIT_SYNC_ENABLED so disabling
// the sync tier does not require disabling the authn tier or vice versa.
export const syncExecutionRateLimitOptions: RateLimitOptions = {
    allowList: () => !system.getBoolean(AppSystemProp.API_RATE_LIMIT_SYNC_ENABLED),
    max: () => Number.parseInt(
        system.getOrThrow(AppSystemProp.API_RATE_LIMIT_SYNC_MAX),
        10,
    ),
    timeWindow: system.getOrThrow(AppSystemProp.API_RATE_LIMIT_SYNC_WINDOW),
}
