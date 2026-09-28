import { Command } from 'commander'
import fs from 'fs'
import path from 'path'
import {
    ConnectionMappingSchema,
    ProjectReplaceApplyResult,
    ProjectReplaceArtifact,
    ProjectReplaceArtifactSchema,
    ProjectStateSnapshot,
} from '@inboxfm-connect/shared'

const EXIT_SUCCESS = 0
const EXIT_PREFLIGHT = 1
const EXIT_VALIDATION = 2
const EXIT_DRIFT = 3
const EXIT_AUTH = 4
const EXIT_TRANSPORT = 5
const EXIT_SERVER = 6

type ReplaceCliOptions = {
    sourceUrl?: string
    sourceToken?: string
    sourceProject?: string
    destUrl: string
    destToken: string
    destProject: string
    planFile?: string
    out?: string
    dryRun?: boolean
    force?: boolean
    deployIntegrations?: boolean
    inspectOnly?: boolean
    connectionMap?: string[]
    providerMap?: string[]
    connectionMappingFile?: string
    connectionBootstrap?: string
    rotateMcpToken?: boolean
    json?: boolean
}

function parseMappingContent(content: string, out: ConnectionMappingSchema[]): void {
    const parsed = JSON.parse(content)
    if (Array.isArray(parsed)) {
        for (const item of parsed) {
            if (item && item.sourceExternalId) {
                out.push(item)
            }
        }
    }
    else if (typeof parsed === 'object' && parsed !== null) {
        if (Array.isArray((parsed as Record<string, unknown>).mappings)) {
            for (const item of (parsed as Record<string, unknown>).mappings as unknown[]) {
                if (item && typeof item === 'object' && 'sourceExternalId' in item) {
                    out.push(item as ConnectionMappingSchema)
                }
            }
        }
        else {
            for (const [key, val] of Object.entries(parsed)) {
                if (typeof val === 'string') {
                    out.push({ sourceExternalId: key, destExternalId: val })
                }
                else if (typeof val === 'object' && val !== null) {
                    out.push({ sourceExternalId: key, ...(val as object) })
                }
            }
        }
    }
}

function parseConnectionMappings(options: ReplaceCliOptions): ConnectionMappingSchema[] {
    const mappings: ConnectionMappingSchema[] = []

    const envVal = process.env.INBOXFM_CONNECTION_MAPPINGS
    if (envVal) {
        try {
            if (fs.existsSync(path.resolve(envVal))) {
                const content = fs.readFileSync(path.resolve(envVal), 'utf-8')
                parseMappingContent(content, mappings)
            }
            else {
                parseMappingContent(envVal, mappings)
            }
        }
        catch (err) {
            console.warn('Warning: Failed to parse INBOXFM_CONNECTION_MAPPINGS:', (err as Error).message)
        }
    }

    if (options.connectionMappingFile) {
        const filePath = path.resolve(options.connectionMappingFile)
        if (!fs.existsSync(filePath)) {
            throw new Error(`Connection mapping file not found: ${filePath}`)
        }
        const content = fs.readFileSync(filePath, 'utf-8')
        parseMappingContent(content, mappings)
    }

    if (options.connectionBootstrap) {
        parseMappingContent(options.connectionBootstrap, mappings)
    }

    if (options.connectionMap) {
        const rawList = Array.isArray(options.connectionMap) ? options.connectionMap : [options.connectionMap]
        for (const item of rawList) {
            for (const part of item.split(',')) {
                const trimmed = part.trim()
                if (!trimmed) continue
                const delimiterIndex = trimmed.indexOf('=') !== -1 ? trimmed.indexOf('=') : trimmed.indexOf(':')
                if (delimiterIndex === -1) {
                    throw new Error(`Invalid connection mapping "${trimmed}". Format must be sourceExternalId=destExternalId`)
                }
                const src = trimmed.slice(0, delimiterIndex).trim()
                const dest = trimmed.slice(delimiterIndex + 1).trim()
                mappings.push({
                    sourceExternalId: src,
                    destExternalId: dest,
                })
            }
        }
    }

    return mappings
}

async function fetchJson<T>(url: string, init: RequestInit): Promise<{ ok: boolean, status: number, data: T }> {
    try {
        const res = await fetch(url, init)
        const text = await res.text()
        let parsed: unknown
        try {
            parsed = JSON.parse(text)
        }
        catch {
            parsed = text
        }
        return { ok: res.ok, status: res.status, data: parsed as T }
    }
    catch (err) {
        throw new Error(`Transport error calling ${url}: ${(err as Error).message}`)
    }
}

export const projectReplaceCommand = new Command('replace')
    .description('Mirror a project configuration from source to destination, or review dry-run plan')
    .option('--source-url <url>', 'Source Activepieces API URL')
    .option('--source-token <token>', 'Source authorization token')
    .option('--source-project <id>', 'Source project ID')
    .requiredOption('--dest-url <url>', 'Destination Activepieces API URL')
    .requiredOption('--dest-token <token>', 'Destination authorization token')
    .requiredOption('--dest-project <id>', 'Destination project ID')
    .option('--plan-file <path>', 'Path to a signed plan artifact JSON file to apply')
    .option('--out <path>', 'Path to write generated plan artifact JSON')
    .option('--dry-run', 'Generate reviewable plan artifact without mutating destination', false)
    .option('--deploy-integrations', 'Deploy missing custom integrations automatically during replace', false)
    .option('--inspect-only', 'Inspect and report missing integrations without applying any changes', false)
    .option('--connection-map <mapping...>', 'Map source connection externalId to destination externalId (e.g. source=dest)')
    .option('--provider-map <mapping...>', 'Map source AI provider ID to destination provider ID (e.g. source=dest)')
    .option('--connection-mapping-file <path>', 'Path to file containing connection mappings or bootstrap secrets')
    .option('--connection-bootstrap <json>', 'JSON string of connection bootstrap credentials')
    .option('--force', 'Bypass preflight warnings', false)
    .option('--rotate-mcp-token', 'Rotate destination MCP server token during apply and output one-time credential', false)
    .option('--json', 'Output machine-readable JSON', false)
    .action(async (options: ReplaceCliOptions) => {
        try {
            const destBase = options.destUrl.replace(/\/$/, '')

            let snapshot: ProjectStateSnapshot
            let artifact: ProjectReplaceArtifact | null = null

            const connectionMappings = parseConnectionMappings(options)
            if (!options.json && connectionMappings.length > 0) {
                const bootstrapCount = connectionMappings.filter((m) => !!m.value).length
                const remapCount = connectionMappings.length - bootstrapCount
                console.log(`Connection mappings loaded: ${connectionMappings.length} (${remapCount} alias, ${bootstrapCount} credentials [REDACTED])`)
            }

            // 1. If --plan-file is supplied, load and validate it with Zod schema
            if (options.planFile) {
                const raw = fs.readFileSync(path.resolve(options.planFile), 'utf-8')
                let parsedJson: unknown
                try {
                    parsedJson = JSON.parse(raw)
                }
                catch (e) {
                    console.error('Invalid JSON in plan file:', (e as Error).message)
                    process.exit(EXIT_VALIDATION)
                }

                const parsed = ProjectReplaceArtifactSchema.safeParse(parsedJson)
                if (!parsed.success) {
                    console.error('Invalid plan file schema:', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', '))
                    process.exit(EXIT_VALIDATION)
                }
                artifact = parsed.data
                snapshot = artifact.snapshot

                // If --dry-run or --inspect-only is passed with --plan-file, verify signature & drift with destination /inspect
                if (options.dryRun || options.inspectOnly) {
                    const inspectRes = await fetchJson<{ applied: Record<string, number>, failed: Array<{ error: string }>, error?: string }>(
                        `${destBase}/api/v1/projects/${options.destProject}/replace/inspect`,
                        {
                            method: 'POST',
                            headers: {
                                Authorization: `Bearer ${options.destToken}`,
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({
                                plan: artifact.plan,
                                snapshot,
                                connectionMappings: connectionMappings.length > 0 ? connectionMappings : undefined,
                            }),
                        },
                    )

                    if (inspectRes.status === 409) {
                        console.error('Error: Destination state has drifted since the plan was created. Re-run plan.')
                        process.exit(EXIT_DRIFT)
                    }

                    if (inspectRes.status === 401 || inspectRes.status === 403) {
                        console.error('Error: Unauthorized on destination:', inspectRes.data)
                        process.exit(EXIT_AUTH)
                    }

                    if (!inspectRes.ok) {
                        console.error(`Error: Plan verification failed on destination (${inspectRes.status}):`, inspectRes.data)
                        process.exit(inspectRes.status >= 500 ? EXIT_SERVER : EXIT_VALIDATION)
                    }

                    if (options.dryRun) {
                        if (options.json) {
                            console.log(JSON.stringify(artifact, null, 2))
                        }
                        else {
                            console.log(`Plan ID: ${artifact.plan.planId}`)
                            console.log(`Checksum: ${artifact.plan.checksum}`)
                            console.log(`Signature: ${artifact.plan.signature} (Verified)`)
                            console.log('\nPlanned Changes:')
                            console.log(`  Creates:   ${artifact.plan.summary.created}`)
                            console.log(`  Updates:   ${artifact.plan.summary.updated}`)
                            console.log(`  Deletes:   ${artifact.plan.summary.deleted}`)
                            console.log(`  Unchanged: ${artifact.plan.summary.unchanged}`)
                            if (artifact.plan.preflight.connections) {
                                const cp = artifact.plan.preflight.connections
                                console.log('\nConnections:')
                                console.log(`  Required:   ${cp.required.length}`)
                                console.log(`  Matched:    ${cp.matched.length}`)
                                console.log(`  Missing:    ${cp.missing.length}`)
                                console.log(`  Mapped:     ${cp.mapped.length}`)
                            }
                        }
                        const totalChanges = artifact.plan.summary.created + artifact.plan.summary.updated + artifact.plan.summary.deleted
                        process.exit(totalChanges > 0 ? 1 : EXIT_SUCCESS)
                    }

                    if (options.inspectOnly) {
                        if (options.json) {
                            console.log(JSON.stringify(artifact, null, 2))
                        }
                        else {
                            console.log('Inspect-only mode: plan verified, no mutations applied.')
                            if (artifact.plan.preflight.customIntegrations) {
                                const ci = artifact.plan.preflight.customIntegrations
                                console.log(`Required integrations:   ${ci.required.map((p) => `${p.name}@${p.version}`).join(', ') || 'none'}`)
                                console.log(`Missing integrations:    ${ci.missing.map((p) => `${p.name}@${p.version}`).join(', ') || 'none'}`)
                            }
                            if (artifact.plan.preflight.connections) {
                                const cp = artifact.plan.preflight.connections
                                console.log(`Required connections:    ${cp.required.map((c) => `${c.externalId} (${c.pieceName})`).join(', ') || 'none'}`)
                                console.log(`Matched connections:     ${cp.matched.map((c) => `${c.sourceExternalId} -> ${c.destExternalId}`).join(', ') || 'none'}`)
                                console.log(`Missing connections:     ${cp.missing.map((c) => `${c.externalId} (${c.pieceName})`).join(', ') || 'none'}`)
                            }
                        }
                        process.exit(EXIT_SUCCESS)
                    }
                }
            }
            else {
                // Otherwise source details are required to fetch snapshot
                if (!options.sourceUrl || !options.sourceToken || !options.sourceProject) {
                    console.error('Error: --source-url, --source-token, and --source-project are required when --plan-file is not provided.')
                    process.exit(EXIT_AUTH)
                }

                const sourceBase = options.sourceUrl.replace(/\/$/, '')
                const exportRes = await fetchJson<ProjectStateSnapshot>(
                    `${sourceBase}/api/v1/projects/${options.sourceProject}/replace/export`,
                    {
                        headers: {
                            Authorization: `Bearer ${options.sourceToken}`,
                            'Content-Type': 'application/json',
                        },
                    },
                )

                if (!exportRes.ok) {
                    console.error(`Error: Failed to export snapshot from source (${exportRes.status}):`, exportRes.data)
                    if (exportRes.status >= 500) process.exit(EXIT_SERVER)
                    process.exit(exportRes.status === 401 || exportRes.status === 403 ? EXIT_AUTH : EXIT_TRANSPORT)
                }
                snapshot = exportRes.data
            }

            // 2. Plan generation (if no plan file is provided)
            if (!artifact) {
                const planRes = await fetchJson<ProjectReplaceArtifact>(
                    `${destBase}/api/v1/projects/${options.destProject}/replace/plan`,
                    {
                        method: 'POST',
                        headers: {
                            Authorization: `Bearer ${options.destToken}`,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            snapshot,
                            connectionMappings: connectionMappings.length > 0 ? connectionMappings : undefined,
                        }),
                    },
                )

                if (planRes.status === 400) {
                    if (planRes.data && (planRes.data as unknown as { plan?: { preflight?: { passed?: boolean, errors: Array<{ kind: string, message: string }> } } }).plan) {
                        const planBody = (planRes.data as unknown as { plan: { preflight: { passed: boolean, errors: Array<{ kind: string, message: string }> } } }).plan
                        if (!options.force && !options.inspectOnly) {
                            if (options.json) {
                                console.log(JSON.stringify(planRes.data, null, 2))
                            }
                            else {
                                console.error('Preflight checks failed on destination:')
                                for (const err of planBody.preflight.errors) {
                                    console.error(`  - [${err.kind}]: ${err.message}`)
                                }
                            }
                            process.exit(EXIT_PREFLIGHT)
                        }
                        else {
                            artifact = planRes.data
                        }
                    }
                    else {
                        console.error(`Error: Validation failed on destination (${planRes.status}):`, planRes.data)
                        process.exit(EXIT_VALIDATION)
                    }
                }
                else if (planRes.status === 401 || planRes.status === 403) {
                    console.error(`Error: Auth failed on destination (${planRes.status}):`, planRes.data)
                    process.exit(EXIT_AUTH)
                }
                else if (planRes.status === 409) {
                    console.error(`Error: Drift detected (${planRes.status}):`, planRes.data)
                    process.exit(EXIT_DRIFT)
                }
                else if (planRes.status >= 500) {
                    console.error(`Error: Server error on destination (${planRes.status}):`, planRes.data)
                    process.exit(EXIT_SERVER)
                }
                else if (!planRes.ok) {
                    console.error(`Error: Failed to generate plan on destination (${planRes.status}):`, planRes.data)
                    process.exit(EXIT_TRANSPORT)
                }
                else {
                    artifact = planRes.data
                }

                if (options.out && artifact) {
                    const outPath = path.resolve(options.out)
                    fs.mkdirSync(path.dirname(outPath), { recursive: true })
                    fs.writeFileSync(outPath, JSON.stringify(artifact, null, 2), 'utf-8')
                }

                if (options.dryRun && artifact) {
                    if (options.json) {
                        console.log(JSON.stringify(artifact, null, 2))
                    }
                    else {
                        console.log(`Plan ID: ${artifact.plan.planId}`)
                        console.log(`Checksum: ${artifact.plan.checksum}`)
                        console.log(`Signature: ${artifact.plan.signature}`)
                        console.log('\nPlanned Changes:')
                        console.log(`  Creates:   ${artifact.plan.summary.created}`)
                        console.log(`  Updates:   ${artifact.plan.summary.updated}`)
                        console.log(`  Deletes:   ${artifact.plan.summary.deleted}`)
                        console.log(`  Unchanged: ${artifact.plan.summary.unchanged}`)
                        if (artifact.plan.preflight.customIntegrations) {
                            const ci = artifact.plan.preflight.customIntegrations
                            console.log('\nCustom Integrations:')
                            console.log(`  Required:   ${ci.required.length}`)
                            console.log(`  Missing:    ${ci.missing.length}`)
                            console.log(`  Deployable: ${ci.deployable.length}`)
                        }
                        if (artifact.plan.preflight.connections) {
                            const cp = artifact.plan.preflight.connections
                            console.log('\nConnections:')
                            console.log(`  Required:   ${cp.required.length}`)
                            console.log(`  Matched:    ${cp.matched.length}`)
                            console.log(`  Missing:    ${cp.missing.length}`)
                            console.log(`  Mapped:     ${cp.mapped.length}`)
                        }
                        if (artifact.plan.preflight.warnings && artifact.plan.preflight.warnings.length > 0) {
                            console.log('\nPreflight Warnings:')
                            for (const warn of artifact.plan.preflight.warnings) {
                                console.log(`  - [${warn.kind}]: ${warn.message}`)
                            }
                        }
                    }
                    if (artifact.plan.changes) {
                        const mcpCreates = artifact.plan.changes.creates.filter(c => c.kind === 'mcp_server').length
                        const mcpUpdates = artifact.plan.changes.updates.filter(c => c.kind === 'mcp_server').length
                        const mcpDeletes = artifact.plan.changes.deletes.filter(c => c.kind === 'mcp_server').length
                        const mcpUnchanged = artifact.plan.changes.unchanged.filter(c => c.kind === 'mcp_server').length
                        if (mcpCreates + mcpUpdates + mcpDeletes + mcpUnchanged > 0) {
                            console.log('\nMCP Server Configuration:')
                            console.log(`  Creates:   ${mcpCreates}`)
                            console.log(`  Updates:   ${mcpUpdates}`)
                            console.log(`  Deletes:   ${mcpDeletes}`)
                            console.log(`  Unchanged: ${mcpUnchanged}`)
                        }
                    }
                    const totalChanges = artifact.plan.summary.created + artifact.plan.summary.updated + artifact.plan.summary.deleted
                    process.exit(totalChanges > 0 ? 1 : EXIT_SUCCESS)
                }

                if (options.inspectOnly && artifact) {
                    if (options.json) {
                        console.log(JSON.stringify(artifact, null, 2))
                    }
                    else {
                        console.log('Inspect-only mode: no mutations applied.')
                        if (artifact.plan.preflight.customIntegrations) {
                            const ci = artifact.plan.preflight.customIntegrations
                            console.log(`Required integrations:   ${ci.required.map((p) => `${p.name}@${p.version}`).join(', ') || 'none'}`)
                            console.log(`Missing integrations:    ${ci.missing.map((p) => `${p.name}@${p.version}`).join(', ') || 'none'}`)
                            console.log(`Deployable integrations: ${ci.deployable.map((p) => `${p.name}@${p.version}`).join(', ') || 'none'}`)
                            console.log(`Compatible integrations: ${ci.compatible.map((p) => `${p.name}@${p.version}`).join(', ') || 'none'}`)
                        }
                        if (artifact.plan.preflight.connections) {
                            const cp = artifact.plan.preflight.connections
                            console.log(`Required connections:    ${cp.required.map((c) => `${c.externalId} (${c.pieceName})`).join(', ') || 'none'}`)
                            console.log(`Matched connections:     ${cp.matched.map((c) => `${c.sourceExternalId} -> ${c.destExternalId}`).join(', ') || 'none'}`)
                            console.log(`Missing connections:     ${cp.missing.map((c) => `${c.externalId} (${c.pieceName})`).join(', ') || 'none'}`)
                        }
                        if (!artifact.plan.preflight.passed) {
                            console.log('\nPreflight checks:')
                            for (const err of artifact.plan.preflight.errors) {
                                console.log(`  - [${err.kind}]: ${err.message}`)
                            }
                        }
                    }
                    process.exit(artifact.plan.preflight.passed ? EXIT_SUCCESS : EXIT_PREFLIGHT)
                }
            }

            // 3. Apply phase
            const applyRes = await fetchJson<ProjectReplaceApplyResult>(
                `${destBase}/api/v1/projects/${options.destProject}/replace/apply`,
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${options.destToken}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        plan: artifact!.plan,
                        snapshot,
                        force: options.force,
                        deployCustomIntegrations: options.deployIntegrations,
                        inspectOnly: options.inspectOnly,
                        connectionMappings: connectionMappings.length > 0 ? connectionMappings : undefined,
                        rotateMcpToken: options.rotateMcpToken,
                    }),
                },
            )

            if (applyRes.status === 409) {
                console.error('Error: Destination state has drifted since the plan was created. Re-run plan or recreate plan artifact.')
                process.exit(EXIT_DRIFT)
            }

            if (applyRes.status === 401 || applyRes.status === 403) {
                console.error('Error: Unauthorized on destination:', applyRes.data)
                process.exit(EXIT_AUTH)
            }

            if (!applyRes.ok && applyRes.status !== 207) {
                console.error(`Error: Apply failed on destination (${applyRes.status}):`, applyRes.data)
                process.exit(applyRes.status >= 500 ? EXIT_SERVER : EXIT_TRANSPORT)
            }

            if (options.json) {
                console.log(JSON.stringify(applyRes.data, null, 2))
            }
            else {
                console.log('Project replacement apply finished:')
                console.log(JSON.stringify(applyRes.data.applied, null, 2))
                if (applyRes.data.mcpCredentials?.token) {
                    console.log('\nDestination MCP Server Credentials [ONE-TIME DISPLAY]:')
                    console.log(`  Token: ${applyRes.data.mcpCredentials.token}`)
                    if (applyRes.data.mcpCredentials.serverUrl) {
                        console.log(`  Server URL: ${applyRes.data.mcpCredentials.serverUrl}`)
                    }
                }
                if (applyRes.data.failed.length > 0) {
                    console.warn(`Warnings: ${applyRes.data.failed.length} items failed to apply.`)
                }
            }

            process.exit(applyRes.data.failed.length > 0 ? 1 : EXIT_SUCCESS)
        }
        catch (err) {
            console.error('Fatal CLI Error:', (err as Error).message)
            if ((err as Error).message.startsWith('Transport error')) {
                process.exit(EXIT_TRANSPORT)
            }
            process.exit(EXIT_VALIDATION)
        }
    })

export {
    EXIT_SUCCESS,
    EXIT_PREFLIGHT,
    EXIT_VALIDATION,
    EXIT_DRIFT,
    EXIT_AUTH,
    EXIT_TRANSPORT,
    EXIT_SERVER,
    parseConnectionMappings,
    parseMappingContent,
}
export type { ReplaceCliOptions }

