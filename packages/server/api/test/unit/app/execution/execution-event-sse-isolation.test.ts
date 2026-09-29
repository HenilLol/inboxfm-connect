import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock(
    '../../../../src/app/helper/pubsub',
    () => ({
        pubsub: {
            subscribe: vi.fn().mockResolvedValue(undefined),
            publish: vi.fn().mockResolvedValue(undefined),
            unsubscribe: vi.fn().mockResolvedValue(undefined),
        },
    }),
)

vi.mock(
    '../../../../src/app/database/redis-connections',
    () => ({ redisConnections: { useExisting: vi.fn().mockResolvedValue(null), getRedisType: vi.fn() } }),
)

import { pubsub } from '../../../../src/app/helper/pubsub'
import { executionEventService } from '../../../../src/app/execution/execution-event.service'

describe('executionEventService — SSE listener isolation (issue #158)', () => {
    let listenerA: (e: any) => void
    let listenerB: (e: any) => void

    beforeEach(() => {
        listenerA = vi.fn()
        listenerB = vi.fn()
        vi.mocked(pubsub.subscribe).mockClear()
        vi.mocked(pubsub.unsubscribe).mockClear()
    })

    it('registers only ONE Redis pubsub subscription regardless of how many clients subscribe', async () => {
        const execId = 'exec-iso-1'
        await executionEventService.subscribe({ executionId: execId, listener: listenerA })
        await executionEventService.subscribe({ executionId: execId, listener: listenerB })

        expect(pubsub.subscribe).toHaveBeenCalledTimes(1)

        await executionEventService.unsubscribe({ executionId: execId, listener: listenerA })
        await executionEventService.unsubscribe({ executionId: execId, listener: listenerB })
    })

    it('does NOT unsubscribe from Redis when only one of two listeners is removed', async () => {
        const execId = 'exec-iso-2'
        await executionEventService.subscribe({ executionId: execId, listener: listenerA })
        await executionEventService.subscribe({ executionId: execId, listener: listenerB })
        vi.mocked(pubsub.unsubscribe).mockClear()

        await executionEventService.unsubscribe({ executionId: execId, listener: listenerA })

        expect(pubsub.unsubscribe).not.toHaveBeenCalled()

        await executionEventService.unsubscribe({ executionId: execId, listener: listenerB })
    })

    it('unsubscribes from Redis only when the last listener is removed', async () => {
        const execId = 'exec-iso-3'
        await executionEventService.subscribe({ executionId: execId, listener: listenerA })
        await executionEventService.subscribe({ executionId: execId, listener: listenerB })
        vi.mocked(pubsub.unsubscribe).mockClear()

        await executionEventService.unsubscribe({ executionId: execId, listener: listenerA })
        expect(pubsub.unsubscribe).not.toHaveBeenCalled()

        await executionEventService.unsubscribe({ executionId: execId, listener: listenerB })
        expect(pubsub.unsubscribe).toHaveBeenCalledTimes(1)
        expect(pubsub.unsubscribe).toHaveBeenCalledWith(`execution:${execId}:events`)
    })
})
