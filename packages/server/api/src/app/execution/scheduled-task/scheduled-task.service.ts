import { ActivepiecesError, apId, ErrorCode, isNil, SeekPage, tryCatch } from '@inboxfm-connect/core-utils'
import { cronParser, scheduler } from '@inboxfm-connect/scheduler'
import {
    CreateScheduledTaskRequest,
    Execution,
    PlatformId,
    ProjectId,
    ScheduledTask,
    ScheduledTaskStatus,
    UpdateScheduledTaskRequest,
} from '@inboxfm-connect/shared'
import { FastifyBaseLogger } from 'fastify'
import { repoFactory } from '../../core/db/repo-factory'
import { getScheduledTaskTickLockKey } from '../../database/redis/keys'
import { distributedStore } from '../../database/redis-connections'
import { executionService } from '../execution.service'
import { ScheduledTaskEntity, ScheduledTaskSchema } from './scheduled-task-entity'

/**
 * Lazy getter: resolving the repository at module scope binds it to whichever
 * DataSource existed when `app.ts` was first imported, which is not necessarily
 * the initialized one.
 */
const scheduledTaskRepo = repoFactory<ScheduledTaskSchema>(ScheduledTaskEntity)

export const scheduledTaskService = {
    async create({ request, projectId, platformId }: CreateParams): Promise<ScheduledTask> {
        if (!cronParser.validateCronExpression(request.cronExpression)) {
            throw new ActivepiecesError({
                code: ErrorCode.VALIDATION,
                params: { message: `Invalid cron expression: ${request.cronExpression}` },
            })
        }

        const id = apId()
        const status = request.status ?? ScheduledTaskStatus.ENABLED
        const timezone = request.timezone ?? 'UTC'
        const nextRunAt = status === ScheduledTaskStatus.ENABLED
            ? computeNextRunAt({ cronExpression: request.cronExpression, timezone })
            : null

        const newTask: ScheduledTask = {
            id,
            created: new Date().toISOString(),
            updated: new Date().toISOString(),
            projectId,
            platformId,
            prompt: request.prompt,
            cronExpression: request.cronExpression,
            timezone,
            status,
            lastRunAt: null,
            nextRunAt,
        }

        const saved = await scheduledTaskRepo().save(newTask)

        if (saved.status === ScheduledTaskStatus.ENABLED) {
            await syncSchedule(saved)
        }

        return saved
    },

    async getOneOrThrow({ id, projectId, platformId }: GetOneParams): Promise<ScheduledTask> {
        const task = await scheduledTaskRepo().findOneBy({ id, projectId, platformId })
        if (isNil(task)) {
            throw new ActivepiecesError({
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: { message: `ScheduledTask ${id} not found` },
            })
        }
        return task
    },

    async list({ projectId, platformId }: ListParams): Promise<SeekPage<ScheduledTask>> {
        const tasks = await scheduledTaskRepo().findBy({ projectId, platformId })
        return {
            data: tasks,
            next: null,
            previous: null,
        }
    },

    async update({ id, projectId, platformId, request }: UpdateParams): Promise<ScheduledTask> {
        const existing = await scheduledTaskService.getOneOrThrow({ id, projectId, platformId })

        if (request.cronExpression !== undefined && !cronParser.validateCronExpression(request.cronExpression)) {
            throw new ActivepiecesError({
                code: ErrorCode.VALIDATION,
                params: { message: `Invalid cron expression: ${request.cronExpression}` },
            })
        }

        const cronExpression = request.cronExpression ?? existing.cronExpression
        const timezone = request.timezone ?? existing.timezone
        const status = request.status ?? existing.status

        const nextRunAt = status === ScheduledTaskStatus.ENABLED
            ? computeNextRunAt({ cronExpression, timezone })
            : null

        const updatedTask: ScheduledTask = {
            ...existing,
            ...(request.prompt !== undefined ? { prompt: request.prompt } : {}),
            cronExpression,
            timezone,
            status,
            nextRunAt,
            updated: new Date().toISOString(),
        }

        const saved = await scheduledTaskRepo().save(updatedTask)

        if (saved.status === ScheduledTaskStatus.ENABLED) {
            await syncSchedule(saved)
        }
        else {
            await scheduler.cancel(getJobName(saved.id))
        }

        return saved
    },

    async delete({ id, projectId, platformId }: GetOneParams): Promise<void> {
        await scheduledTaskService.getOneOrThrow({ id, projectId, platformId })
        await scheduler.cancel(getJobName(id))
        await scheduledTaskRepo().delete({ id, projectId, platformId })
    },

    async triggerNow({ id, projectId, platformId }: GetOneParams): Promise<Execution> {
        const task = await scheduledTaskService.getOneOrThrow({ id, projectId, platformId })
        return dispatchExecution(task)
    },

    async reRegisterEnabledSchedules({ log }: { log: FastifyBaseLogger }): Promise<{ tasks: number }> {
        const tasks = await scheduledTaskRepo().findBy({ status: ScheduledTaskStatus.ENABLED })
        let registered = 0
        for (const task of tasks) {
            try {
                if (!cronParser.validateCronExpression(task.cronExpression)) {
                    log.warn({ task: { id: task.id } }, '[scheduledTaskService#reRegisterEnabledSchedules] Skipping schedule with invalid cron expression')
                    continue
                }
                await syncSchedule(task)
                const nextRunAt = computeNextRunAt({ cronExpression: task.cronExpression, timezone: task.timezone })
                await scheduledTaskRepo().update({ id: task.id }, { nextRunAt })
                registered += 1
            }
            catch (error) {
                log.warn({ error, task: { id: task.id } }, '[scheduledTaskService#reRegisterEnabledSchedules] Skipping schedule that failed to register')
            }
        }
        return { tasks: registered }
    },
}

function getJobName(taskId: string): string {
    return `user-task-${taskId}`
}

function computeNextRunAt({ cronExpression, timezone }: { cronExpression: string, timezone: string }): string {
    return cronParser.computeNextTick({ cronExpression, timezone }).toISOString()
}

async function claimTaskTick(task: ScheduledTask): Promise<boolean> {
    const key = getScheduledTaskTickLockKey(task.id)
    let ttlSeconds = 55
    try {
        const next = cronParser.computeNextTick({ cronExpression: task.cronExpression, timezone: task.timezone })
        const diffSeconds = Math.floor((next.getTime() - Date.now()) / 1000)
        ttlSeconds = Math.max(1, Math.min(55, diffSeconds - 1))
    }
    catch {
        ttlSeconds = 55
    }
    const result = await tryCatch(() => distributedStore.putIfAbsent(key, 1, ttlSeconds))
    if (result.error === null) {
        return result.data
    }
    return true
}

async function syncSchedule(task: ScheduledTask): Promise<void> {
    const jobName = getJobName(task.id)
    await scheduler.cron({
        name: jobName,
        cronExpression: task.cronExpression,
        timezone: task.timezone,
        fn: async () => {
            const current = await scheduledTaskRepo().findOneBy({ id: task.id })
            if (!current || current.status !== ScheduledTaskStatus.ENABLED) {
                await scheduler.cancel(jobName)
                return
            }
            const isLeader = await claimTaskTick(current)
            if (!isLeader) {
                return
            }
            await dispatchExecution(current)
        },
    })
}

async function dispatchExecution(task: ScheduledTask): Promise<Execution> {
    const execution = await executionService.create({
        prompt: task.prompt,
        metadata: {
            scheduledTaskId: task.id,
            cronExpression: task.cronExpression,
            timezone: task.timezone,
        },
        projectId: task.projectId,
        platformId: task.platformId,
    })

    let nextRunAt: string | null = null
    try {
        nextRunAt = computeNextRunAt({ cronExpression: task.cronExpression, timezone: task.timezone })
    }
    catch {
        nextRunAt = null
    }

    await scheduledTaskRepo().update({ id: task.id }, {
        lastRunAt: new Date().toISOString(),
        nextRunAt,
    })
    return execution
}

type CreateParams = {
    request: CreateScheduledTaskRequest
    projectId: ProjectId
    platformId: PlatformId
}

type GetOneParams = {
    id: string
    projectId: ProjectId
    platformId: PlatformId
}

type ListParams = {
    projectId: ProjectId
    platformId: PlatformId
}

type UpdateParams = {
    id: string
    projectId: ProjectId
    platformId: PlatformId
    request: UpdateScheduledTaskRequest
}
