// RED test: concurrent upserts of the same connection must not create duplicates.
// A unique index on (platformId, externalId, scope) makes the second insert
// fail into the update path; without it, two "no existing row" reads race
// into two inserts with different apIds.
import {FastifyBaseLogger} from 'fastify'
import {appConnectionService} from '@/app/app-connection/app-connection-service/app-connection-service'
import {AppConnectionScope} from '@inboxfm-connect/shared'
import {databaseConnection} from '@/app/database/database-connection'
import {seedPlatform} from '../../../seed_platform'

type Db = Awaited<ReturnType<typeof databaseConnection>>

async function countConnections(db: Db, externalId: string): Promise<number> {
    const result = await db.executeQuery(`SELECT COUNT(*)::int AS n FROM app_connection WHERE external_id = '${externalId}'`)
    return result[0].n
}

describe('app-connection upsert dedup', () => {
    let db: Db
    const externalId = 'race-test-conn'

    beforeAll(async () => {
        await seedPlatform()
        db = await databaseConnection()
        await db.executeQuery(`DELETE FROM app_connection WHERE external_id = '${externalId}'`)
    })

    it('two concurrent upserts of the same connection produce exactly one row', async () => {
        const base = {
            externalId,
            pieceName: 'openai',
            displayName: 'Race Conn',
            platformId: 'platform-test-id',
            projectIds: ['p1'],
            scope: AppConnectionScope.PROJECT,
        }
        const [a, b] = await Promise.all([
            appConnectionService({} as FastifyBaseLogger).upsert({...base, type: 'NO_AUTH', value: {type: 'NO_AUTH'}}),
            appConnectionService({} as FastifyBaseLogger).upsert({...base, type: 'NO_AUTH', value: {type: 'NO_AUTH'}}),
        ])
        expect(a.id).toBe(b.id)
        const n = await countConnections(db, externalId)
        expect(n).toBe(1)
    })
})
