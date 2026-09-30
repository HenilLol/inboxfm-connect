import { QueryRunner } from 'typeorm'
import { Migration } from '../../migration'

export class AddMcpOAuthFamilyLineage1790742883005 implements Migration {
    name = 'AddMcpOAuthFamilyLineage1790742883005'
    breaking = false
    release = '0.88.0'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Add familyId column to mcp_oauth_token for token lineage tracking
        await queryRunner.query(`
            ALTER TABLE "mcp_oauth_token"
            ADD COLUMN "familyId" character varying(64)
        `)

        // Add index on familyId for family revocation queries
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "idx_mcp_oauth_token_family_id"
            ON "mcp_oauth_token" ("familyId")
        `)
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            DROP INDEX IF EXISTS "idx_mcp_oauth_token_family_id"
        `)
        await queryRunner.query(`
            ALTER TABLE "mcp_oauth_token"
            DROP COLUMN "familyId"
        `)
    }
}
