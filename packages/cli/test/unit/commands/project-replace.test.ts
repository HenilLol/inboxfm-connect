import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ConnectionMappingSchema } from '@inboxfm-connect/shared'
import { describe, expect, it } from 'vitest'
import {
    parseConnectionMappings,
    parseMappingContent,
    projectReplaceCommand,
} from '../../../src/lib/commands/project-replace'

describe('Project Replace CLI Command & Flag Parsing (Issue #139)', () => {
    describe('Command Configuration & Option Registration', () => {
        it('registers replace command with all required and optional flags', () => {
            expect(projectReplaceCommand.name()).toBe('replace')
            expect(projectReplaceCommand.description()).toContain('Mirror a project configuration')

            const options = projectReplaceCommand.options.map((opt) => opt.long)

            // Required options
            expect(options).toContain('--dest-url')
            expect(options).toContain('--dest-token')
            expect(options).toContain('--dest-project')

            // Source options
            expect(options).toContain('--source-url')
            expect(options).toContain('--source-token')
            expect(options).toContain('--source-project')

            // Artifact and flow options
            expect(options).toContain('--plan-file')
            expect(options).toContain('--out')
            expect(options).toContain('--dry-run')
            expect(options).toContain('--deploy-integrations')
            expect(options).toContain('--inspect-only')
            expect(options).toContain('--force')
            expect(options).toContain('--rotate-mcp-token')
            expect(options).toContain('--json')

            // Mapping options
            expect(options).toContain('--connection-map')
            expect(options).toContain('--provider-map')
            expect(options).toContain('--connection-mapping-file')
            expect(options).toContain('--connection-bootstrap')
        })
    })

    describe('parseMappingContent', () => {
        it('parses an array of ConnectionMappingSchema objects', () => {
            const mappings: ConnectionMappingSchema[] = []
            const content = JSON.stringify([
                { sourceExternalId: 'slack-1', destExternalId: 'slack-target-1' },
                { sourceExternalId: 'gmail-1', destExternalId: 'gmail-target-1' },
            ])

            parseMappingContent(content, mappings)

            expect(mappings).toHaveLength(2)
            expect(mappings[0]).toEqual({ sourceExternalId: 'slack-1', destExternalId: 'slack-target-1' })
            expect(mappings[1]).toEqual({ sourceExternalId: 'gmail-1', destExternalId: 'gmail-target-1' })
        })

        it('parses nested { mappings: [...] } structure', () => {
            const mappings: ConnectionMappingSchema[] = []
            const content = JSON.stringify({
                mappings: [
                    { sourceExternalId: 'notion-1', destExternalId: 'notion-dest' },
                ],
            })

            parseMappingContent(content, mappings)

            expect(mappings).toHaveLength(1)
            expect(mappings[0]).toEqual({ sourceExternalId: 'notion-1', destExternalId: 'notion-dest' })
        })

        it('parses simple key-value dictionary as sourceExternalId -> destExternalId mappings', () => {
            const mappings: ConnectionMappingSchema[] = []
            const content = JSON.stringify({
                'source-conn-a': 'dest-conn-a',
                'source-conn-b': 'dest-conn-b',
            })

            parseMappingContent(content, mappings)

            expect(mappings).toHaveLength(2)
            expect(mappings).toContainEqual({ sourceExternalId: 'source-conn-a', destExternalId: 'dest-conn-a' })
            expect(mappings).toContainEqual({ sourceExternalId: 'source-conn-b', destExternalId: 'dest-conn-b' })
        })
    })

    describe('parseConnectionMappings CLI options', () => {
        it('parses --connection-map flag with = and : delimiters', () => {
            const options = {
                destUrl: 'http://localhost:3000',
                destToken: 'test-dest-token',
                destProject: 'proj-123',
                connectionMap: ['src1=dest1', 'src2:dest2', 'src3=dest3,src4=dest4'],
            }

            const mappings = parseConnectionMappings(options)

            expect(mappings).toHaveLength(4)
            expect(mappings).toEqual([
                { sourceExternalId: 'src1', destExternalId: 'dest1' },
                { sourceExternalId: 'src2', destExternalId: 'dest2' },
                { sourceExternalId: 'src3', destExternalId: 'dest3' },
                { sourceExternalId: 'src4', destExternalId: 'dest4' },
            ])
        })

        it('throws an error if --connection-map format is invalid (missing delimiter)', () => {
            const options = {
                destUrl: 'http://localhost:3000',
                destToken: 'test-dest-token',
                destProject: 'proj-123',
                connectionMap: ['invalid-mapping-without-delimiter'],
            }

            expect(() => parseConnectionMappings(options)).toThrow(
                /Invalid connection mapping "invalid-mapping-without-delimiter"/,
            )
        })

        it('loads connection mappings from --connection-mapping-file', () => {
            const tempFile = path.join(os.tmpdir(), `test-conn-map-${Date.now()}.json`)
            fs.writeFileSync(
                tempFile,
                JSON.stringify({
                    'src-file-1': 'dest-file-1',
                }),
                'utf-8',
            )

            try {
                const options = {
                    destUrl: 'http://localhost:3000',
                    destToken: 'test-dest-token',
                    destProject: 'proj-123',
                    connectionMappingFile: tempFile,
                }

                const mappings = parseConnectionMappings(options)
                expect(mappings).toHaveLength(1)
                expect(mappings[0]).toEqual({ sourceExternalId: 'src-file-1', destExternalId: 'dest-file-1' })
            }
            finally {
                fs.unlinkSync(tempFile)
            }
        })

        it('throws an error when --connection-mapping-file does not exist', () => {
            const options = {
                destUrl: 'http://localhost:3000',
                destToken: 'test-dest-token',
                destProject: 'proj-123',
                connectionMappingFile: '/non/existent/path/mappings.json',
            }

            expect(() => parseConnectionMappings(options)).toThrow(/Connection mapping file not found/)
        })

        it('parses inline --connection-bootstrap credentials', () => {
            const bootstrapJson = JSON.stringify([
                {
                    sourceExternalId: 'slack-bot',
                    destExternalId: 'slack-bot-prod',
                    value: {
                        type: 'SECRET_TEXT',
                        secret_text: 'xoxb-secret-token-12345',
                    },
                },
            ])

            const options = {
                destUrl: 'http://localhost:3000',
                destToken: 'test-dest-token',
                destProject: 'proj-123',
                connectionBootstrap: bootstrapJson,
            }

            const mappings = parseConnectionMappings(options)
            expect(mappings).toHaveLength(1)
            expect(mappings[0].sourceExternalId).toBe('slack-bot')
            expect(mappings[0].destExternalId).toBe('slack-bot-prod')
            expect(mappings[0].value).toBeDefined()
        })
    })
})
