import { AIProviderName, ProjectId, UserId } from '@inboxfm-connect/core-utils'
import { apVersionUtil } from '@inboxfm-connect/server-utils'
import { ApEdition, FlowRunStatus, RunEnvironment, TelemetryEvent, User, UserIdentity } from '@inboxfm-connect/shared'
import { FastifyBaseLogger } from 'fastify'
import { PostHog } from 'posthog-node'
import { platformService } from '../platform/platform.service'
import { projectService } from '../project/project-service'
import { system } from './system/system'
import { AppSystemProp } from './system/system-props'

// Issue #406: the enabled-flag used to be captured once at module load, so runtime
// flag changes (platform-level telemetry management, tests, hot config reloads)
// never took effect until a restart. It is now read per call.
// Identity PII (email/firstName/lastName) to PostHog is separately opt-in via
// TELEMETRY_INCLUDE_PII: without it, usage telemetry still flows but identity
// fields are stripped.
function isTelemetryEnabled(): boolean {
    return system.getBoolean(AppSystemProp.TELEMETRY_ENABLED) ?? true
}

function includeTelemetryPii(): boolean {
    return system.getBoolean(AppSystemProp.TELEMETRY_INCLUDE_PII) ?? false
}

let posthogInstance: PostHog | null = null
function getPostHog(): PostHog {
    if (!posthogInstance) {
        posthogInstance = new PostHog('phc_7F92HoXJPeGnTKmYv0eOw62FurPMRW9Aqr0TPrDzvHh', {
            host: 'https://us.i.posthog.com',
        })
    }
    return posthogInstance
}

export const telemetry = (log: FastifyBaseLogger) => ({
    async identify(identity: UserIdentity, user?: User, projectId?: ProjectId): Promise<void> {
        if (!isTelemetryEnabled()) {
            return
        }
        // Issue #406: identity PII only leaves the instance when explicitly opted in
        // via TELEMETRY_INCLUDE_PII; by default the event carries ids and metadata only.
        const pii = includeTelemetryPii()
        getPostHog().identify({
            distinctId: user?.id ?? identity.id,
            properties: {
                ...(pii ? {
                    email: identity.email,
                    firstName: identity.firstName,
                    lastName: identity.lastName,
                } : {}),
                projectId,
                firstSeenAt: user?.created ?? identity.created,
                ...(await getMetadata()),
            },
        })
    },
    async trackPlatform(platformId: ProjectId, event: TelemetryEvent): Promise<void> {
        if (!isTelemetryEnabled()) {
            return
        }
        const platform = await platformService(log).getOneOrThrow(platformId)
        await this.trackUser(platform.ownerId, event, { platform: platformId })
    },
    async trackProject(
        projectId: ProjectId,
        event: TelemetryEvent,
    ): Promise<void> {
        if (!isTelemetryEnabled()) {
            return
        }
        const project = await projectService(log).getOne(projectId)
        return this.trackUser(project!.ownerId, event, { platform: project!.platformId })
    },
    isEnabled: () => isTelemetryEnabled(),
    async trackUser(userId: UserId, event: TelemetryEvent, groups?: Record<string, string>): Promise<void> {
        if (!isTelemetryEnabled()) {
            return
        }
        const payloadEvent = {
            distinctId: userId,
            event: event.name,
            properties: {
                ...event.payload,
                ...(await getMetadata()),
                datetime: new Date().toISOString(),
            },
            groups,
        }
        // Issue #406: the payload no longer enters the app log - PostHog is the
        // delivery channel, not the log pipeline; logs carry a different retention
        // policy than consented telemetry.
        log.debug({ event: event.name, distinctId: userId }, '[Telemetry#trackUser] sending event')
        getPostHog().capture(payloadEvent)
    },
})

export function captureBillingEvent({ licenseKey, event, properties }: CaptureBillingEventParams): void {
    getPostHog().capture({
        distinctId: licenseKey,
        event,
        properties,
    })
}

export async function shutdownTelemetry(): Promise<void> {
    if (posthogInstance) {
        await posthogInstance.shutdown()
    }
}

async function getMetadata() {
    const currentVersion = apVersionUtil.getCurrentRelease()
    const edition = system.getEdition()
    return {
        activepiecesVersion: currentVersion,
        activepiecesEnvironment: system.get(AppSystemProp.ENVIRONMENT),
        activepiecesEdition: edition,
        source_site: 'product',
    }
}

export enum BillingEvents {
    AI_USAGE_PER_RUN = 'ai_usage_per_run',
    CHAT_MESSAGE = 'chat_message',
    TOTAL_RUNS_PER_DAY = 'total_runs_per_day',
}

export type AiUsagePerRunProperties = {
    platformId: string
    projectId: string
    edition: ApEdition
    flowRunId: string
    flowId: string
    status: FlowRunStatus
    environment: RunEnvironment
    messages: number
    toolCalls: number
    breakdown: Array<{ provider: string, model: string, messages: number, toolCalls: number }>
}

export type TotalRunsPerDayProperties = {
    platform_id: string
    active_flows: number
    projects: number
    users: number
    daily_executions: Array<{ date: string, count: number }>
    reported_at: string
}

export type ChatMessageProperties = {
    provider: AIProviderName | null
    model: string | null
    toolsUsed: number
}

type CaptureBillingEventParams = { licenseKey: string } & (
    | { event: BillingEvents.AI_USAGE_PER_RUN, properties: AiUsagePerRunProperties }
    | { event: BillingEvents.TOTAL_RUNS_PER_DAY, properties: TotalRunsPerDayProperties }
    | { event: BillingEvents.CHAT_MESSAGE, properties: ChatMessageProperties }
)
