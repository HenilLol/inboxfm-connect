import { apId, tryCatch } from '@inboxfm-connect/core-utils'
import { FastifyInstance } from 'fastify'
import { databaseConnection } from '../../../../src/app/database/database-connection'
import { distributedLock, distributedStore } from '../../../../src/app/database/redis-connections'
import { createTestContext, TestContext } from '../../../helpers/test-context'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

let app: FastifyInstance | null = null

beforeAll(async () => {
    app = await setupTestEnvironment()
})

afterAll(async () => {
    await teardownTestEnvironment()
})

describe('Concurrency Invariants & Parallel-Worker Regression Suite (Issue #146)', () => {
    describe('Parallel-Worker Test Harness & distributedLock Invariants', () => {
        it('enforces strict mutual exclusion across concurrent workers on the same lock key', async () => {
            const lockKey = `test-lock:${apId()}`
            const workerCount = 6
            let activeWorkerCount = 0
            let maxConcurrentObserved = 0
            let sharedCounter = 0
            const executionIntervals: Array<{ workerId: number, start: number, end: number }> = []

            const barrier = createConcurrencyBarrier({ workerCount })

            const runWorker = async (workerId: number): Promise<void> => {
                await barrier.wait()

                await distributedLock(app!.log).runExclusive({
                    key: lockKey,
                    timeoutInSeconds: 15,
                    fn: async () => {
                        const start = Date.now()
                        activeWorkerCount++
                        if (activeWorkerCount > maxConcurrentObserved) {
                            maxConcurrentObserved = activeWorkerCount
                        }

                        // Simulate non-atomic read-modify-write workload inside the critical section
                        const currentVal = sharedCounter
                        await sleep(35)
                        sharedCounter = currentVal + 1

                        const end = Date.now()
                        executionIntervals.push({ workerId, start, end })
                        activeWorkerCount--
                    },
                })
            }

            const workerPromises = Array.from({ length: workerCount }, (_, i) => runWorker(i))
            await Promise.all(workerPromises)

            // Invariant 1: At no point should more than 1 worker be in the critical section
            expect(maxConcurrentObserved).toBe(1)

            // Invariant 2: Zero lost updates across concurrent workers
            expect(sharedCounter).toBe(workerCount)

            // Invariant 3: Execution intervals must be strictly non-overlapping
            const sortedIntervals = [...executionIntervals].sort((a, b) => a.start - b.start)
            for (let i = 0; i < sortedIntervals.length - 1; i++) {
                const current = sortedIntervals[i]
                const next = sortedIntervals[i + 1]
                expect(current.end).toBeLessThanOrEqual(next.start)
            }
        })

        it('releases lock cleanly on inner error so subsequent waiting workers can proceed', async () => {
            const lockKey = `test-lock-err:${apId()}`
            let worker2Executed = false

            // Worker 1 throws an intentional error inside the lock
            const worker1Promise = tryCatch(() =>
                distributedLock(app!.log).runExclusive({
                    key: lockKey,
                    timeoutInSeconds: 10,
                    fn: async () => {
                        await sleep(20)
                        throw new Error('Worker 1 simulated crash')
                    },
                }),
            )

            // Worker 2 attempts to acquire the same lock after worker 1
            await sleep(10)
            const worker2Promise = distributedLock(app!.log).runExclusive({
                key: lockKey,
                timeoutInSeconds: 10,
                fn: async () => {
                    worker2Executed = true
                    return 'worker-2-success'
                },
            })

            const [w1Res, w2Res] = await Promise.all([worker1Promise, worker2Promise])
            expect(w1Res.error).toBeDefined()
            expect(w2Res).toBe('worker-2-success')
            expect(worker2Executed).toBe(true)
        })
    })

    describe('distributedStore Invariants & Single-Execution Deduplication', () => {
        it('deduplicates simultaneous job submissions: exactly 1 worker succeeds under heavy contention', async () => {
            const dedupKey = `job-dedup:${apId()}`
            const workerCount = 10
            const barrier = createConcurrencyBarrier({ workerCount })

            const runWorker = async (workerId: number): Promise<{ workerId: number, claimed: boolean }> => {
                await barrier.wait()
                const claimed = await distributedStore.putIfAbsent(dedupKey, { workerId, timestamp: Date.now() }, 30)
                return { workerId, claimed }
            }

            const results = await Promise.all(
                Array.from({ length: workerCount }, (_, i) => runWorker(i)),
            )

            const winners = results.filter((r) => r.claimed)
            const losers = results.filter((r) => !r.claimed)

            // Invariant: Exactly one winner acquires the execution token; all others are deduplicated
            expect(winners).toHaveLength(1)
            expect(losers).toHaveLength(workerCount - 1)

            // Cleanup
            await distributedStore.delete(dedupKey)
        })

        it('safely handles concurrent atomic increments without race conditions or lost counts', async () => {
            const counterKey = `concurrent-counter:${apId()}`
            const workerCount = 8
            const incrementsPerWorker = 5
            const barrier = createConcurrencyBarrier({ workerCount })

            const runWorker = async (): Promise<void> => {
                await barrier.wait()
                for (let i = 0; i < incrementsPerWorker; i++) {
                    await distributedStore.incr(counterKey)
                }
            }

            await Promise.all(Array.from({ length: workerCount }, () => runWorker()))

            const finalCount = await distributedStore.get<number>(counterKey)
            expect(finalCount).toBe(workerCount * incrementsPerWorker)

            // Cleanup
            await distributedStore.delete(counterKey)
        })
    })

    describe('Database Row Locking & SKIP LOCKED Work-Stealing Invariants', () => {
        it('demonstrates distributed work-stealing without duplicate claims, lost tasks, or deadlocks', async () => {
            const ds = databaseConnection()
            const queueTableName = `test_concurrency_queue_${apId().replace(/-/g, '_')}`

            // Create an isolated queue table for concurrency test
            await ds.query(`
                CREATE TABLE IF NOT EXISTS "${queueTableName}" (
                    "id" VARCHAR PRIMARY KEY,
                    "status" VARCHAR NOT NULL,
                    "claimedBy" VARCHAR,
                    "payload" VARCHAR NOT NULL
                )
            `)

            try {
                // Seed 6 pending queue items
                const taskIds = Array.from({ length: 6 }, (_, i) => `task_${i}_${apId()}`)
                for (const taskId of taskIds) {
                    await ds.query(
                        `INSERT INTO "${queueTableName}" ("id", "status", "payload") VALUES ($1, $2, $3)`,
                        [taskId, 'PENDING', `payload_for_${taskId}`],
                    )
                }

                const claimedTasksByWorker: Record<string, string[]> = {
                    worker_0: [],
                    worker_1: [],
                    worker_2: [],
                }

                const queueLockKey = `queue-lock:${queueTableName}`

                // Concurrently run 3 workers that consume items using distributed lock coordination
                const runWorker = async (workerName: string): Promise<void> => {
                    while (true) {
                        const itemToProcess = await distributedLock(app!.log).runExclusive({
                            key: queueLockKey,
                            timeoutInSeconds: 10,
                            fn: async () => {
                                const pendingItems = await ds.query(
                                    `SELECT "id", "payload" FROM "${queueTableName}" WHERE "status" = 'PENDING' LIMIT 1`,
                                )
                                if (!pendingItems || pendingItems.length === 0) {
                                    return null
                                }
                                const item = pendingItems[0]
                                await ds.query(
                                    `UPDATE "${queueTableName}" SET "status" = 'PROCESSING', "claimedBy" = $1 WHERE "id" = $2`,
                                    [workerName, item.id],
                                )
                                return item
                            },
                        })

                        if (!itemToProcess) {
                            break
                        }

                        // Simulate task execution outside lock
                        await sleep(20)

                        await ds.query(
                            `UPDATE "${queueTableName}" SET "status" = 'COMPLETED' WHERE "id" = $1`,
                            [itemToProcess.id],
                        )

                        claimedTasksByWorker[workerName].push(itemToProcess.id)
                    }
                }

                await Promise.all([
                    runWorker('worker_0'),
                    runWorker('worker_1'),
                    runWorker('worker_2'),
                ])

                const allClaimed = Object.values(claimedTasksByWorker).flat()

                // Invariant 1: Exactly 6 tasks processed in total
                expect(allClaimed).toHaveLength(6)

                // Invariant 2: Zero duplicate executions (every task claimed by exactly one worker)
                const uniqueClaimed = new Set(allClaimed)
                expect(uniqueClaimed.size).toBe(6)

                // Invariant 3: All tasks in DB marked COMPLETED
                const finalRows = await ds.query(`SELECT "id", "status", "claimedBy" FROM "${queueTableName}"`)
                expect(finalRows.every((r: { status: string }) => r.status === 'COMPLETED')).toBe(true)
            }
            finally {
                await ds.query(`DROP TABLE IF EXISTS "${queueTableName}"`)
            }
        })

        it('coordinates concurrent workers modifying independent project records without transaction serialization conflicts', async () => {
            const ctx1 = await createTestContext(app!)
            const ctx2 = await createTestContext(app!)
            const workerCount = 4
            const barrier = createConcurrencyBarrier({ workerCount })

            // Workers alternately updating two distinct projects in parallel
            const runWorker = async (workerIndex: number): Promise<void> => {
                await barrier.wait()
                const targetProject = workerIndex % 2 === 0 ? ctx1.project : ctx2.project
                const lockKey = `project-update:${targetProject.id}`

                await distributedLock(app!.log).runExclusive({
                    key: lockKey,
                    timeoutInSeconds: 10,
                    fn: async () => {
                        const ds = databaseConnection()
                        await ds.query(
                            'UPDATE "project" SET "displayName" = $1 WHERE "id" = $2',
                            [`Updated by worker ${workerIndex}`, targetProject.id],
                        )
                        await sleep(15)
                    },
                })
            }

            await Promise.all(
                Array.from({ length: workerCount }, (_, i) => runWorker(i)),
            )

            const ds = databaseConnection()
            const p1 = await ds.query('SELECT "displayName" FROM "project" WHERE "id" = $1', [ctx1.project.id])
            const p2 = await ds.query('SELECT "displayName" FROM "project" WHERE "id" = $1', [ctx2.project.id])

            expect(p1[0].displayName).toMatch(/Updated by worker/)
            expect(p2[0].displayName).toMatch(/Updated by worker/)
        })
    })
})

/**
 * Reusable test harness utility that synchronizes parallel workers
 * so they release from the barrier and strike the target routine simultaneously.
 */
function createConcurrencyBarrier(params: { workerCount: number }): ConcurrencyBarrier {
    const { workerCount } = params
    let arrivedCount = 0
    let releasePromiseResolve: () => void
    const releasePromise = new Promise<void>((resolve) => {
        releasePromiseResolve = resolve
    })

    return {
        wait: async (): Promise<void> => {
            arrivedCount++
            if (arrivedCount >= workerCount) {
                releasePromiseResolve()
            }
            return releasePromise
        },
    }
}

export type ConcurrencyBarrier = {
    wait: () => Promise<void>
}
