import { describe, expect, it } from 'vitest'

// Pins the fork's user-facing brand contract: every surface an end user, IdP admin,
// or external MCP operator sees must say Inboxfm Connect — never the upstream brand.
// Deliberately does not touch URLs (docs/CDN hosts still resolve upstream) or
// security-sensitive identifiers (JWT issuer, log service names), which are
// intentionally out of scope for the rebrand.
describe('User-facing brand residue (fork rebrand sweep)', () => {
    it('no user-facing string in the audited files still says the upstream brand', async () => {
        const { readFile } = await import('node:fs/promises')
        const { resolve } = await import('node:path')
        const auditedFiles = [
            'src/app/app.ts',
            'src/app/flags/theme.ts',
            'src/app/mcp/mcp-server-builder.ts',
            'src/app/agents/mcp-tool-validator.ts',
            'src/app/ai/ai-provider-service.ts',
            'src/app/ai/providers/index.ts',
            'src/app/ee/authentication/saml-authn/saml-client.ts',
            'src/app/ee/scim/scim-discovery-controller.ts',
            'src/app/ee/secret-managers/secret-manager-providers/onepassword-provider.ts',
            'src/app/ee/platform/platform-plan/platform-ai-credits.service.ts',
        ]
        for (const file of auditedFiles) {
            const content = await readFile(resolve(__dirname, '../../..', file), 'utf-8')
            expect(content, file).not.toContain('\'Activepieces\'')
            expect(content, file).not.toContain('\'activepieces-validator\'')
            expect(content, file).not.toContain('entityID: \'Activepieces\'')
        }
    })

    it('the default theme carries the fork name', async () => {
        const { defaultTheme } = await import('../../../src/app/flags/theme')
        expect(defaultTheme.websiteName).toBe('Inboxfm Connect')
        expect(defaultTheme.websiteName.toLowerCase()).not.toContain('activepieces')
    })
})