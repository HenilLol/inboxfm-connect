import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

function findRepoRoot(startDir: string): string {
    let current = startDir
    while (current !== path.dirname(current)) {
        if (fs.existsSync(path.join(current, 'package.json')) && fs.existsSync(path.join(current, 'packages'))) {
            return current
        }
        current = path.dirname(current)
    }
    throw new Error('Could not find repo root')
}

describe('SSRF Guard Enforcement - Repo Scan', () => {
    const repoRoot = findRepoRoot(__dirname)
    const sourceDirs = [
        'packages/server/api/src/app',
        'packages/server/sandbox/src',
        'packages/core/execution/src',
    ]

    const excludedFiles = new Set([
        'packages/integrations/common/src/lib/http/core/fetch-http-client.ts',
    ])

    function findRawHttpUsage(dir: string): { file: string; line: number; content: string }[] {
        const violations: { file: string; line: number; content: string }[] = []
        const files = fs.readdirSync(dir)

        for (const file of files) {
            const fullPath = path.join(dir, file)
            const stat = fs.statSync(fullPath)

            if (stat.isDirectory()) {
                if (file !== 'node_modules' && file !== 'dist' && file !== '.turbo' && file !== 'test') {
                    violations.push(...findRawHttpUsage(fullPath))
                }
            } else if (file.endsWith('.ts') && !file.endsWith('.d.ts') && !file.endsWith('.test.ts')) {
                const relativePath = path.relative(repoRoot, fullPath)
                if (excludedFiles.has(relativePath)) continue

                const content = fs.readFileSync(fullPath, 'utf-8')
                const lines = content.split('\n')

                lines.forEach((line, idx) => {
                    const trimmed = line.trim()
                    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return

                    // Check for raw axios usage
                    if (/\baxios\.(get|post|put|delete|patch|head|request)\b/.test(line) &&
                        !/safeHttp/.test(line) &&
                        !/axios\.isAxiosError/.test(line)) {
                        violations.push({ file: relativePath, line: idx + 1, content: line.trim() })
                    }

                    // Raw fetch usage. The original pattern was /\bfetch\(/, which a
                    // caller evades trivially with `globalThis.fetch(...)` or by
                    // binding the global to another name, so both shapes are matched
                    // here and the matcher is exercised by a self-test below.
                    const isRawFetch =
                        /\bfetch\s*\(/.test(line) ||
                        /\b(globalThis|window|self|global)\s*\.\s*fetch\s*\(/.test(line) ||
                        /=\s*(globalThis|window|self|global)?\s*\.?\s*fetch\s*(\s*[;,)]|\s*$)/.test(line)
                    if (isRawFetch &&
                        !/node-fetch/.test(line) &&
                        !/safeHttp/.test(line) &&
                        !/\.\s*fetch\s*\(/.test(line.replace(/\b(globalThis|window|self|global)\s*\.\s*fetch\s*\(/, ''))) {
                        violations.push({ file: relativePath, line: idx + 1, content: line.trim() })
                    }
                })
            }
        }

        return violations
    }

    /**
     * Baseline of known raw-HTTP call sites, counted against current `dev`:
     * google token exchange, license-key service (4), openrouter keys (4), and
     * the sign-up newsletter egress (1) - the last of which #235 removes, so
     * expect this to drop to 9 when that lands.
     *
     * The previous gate was `toBeLessThanOrEqual(50)`, which permitted 5x the
     * real count and so could not fail on a regression in any meaningful sense.
     * Lowering it to the measured count makes adding a new unguarded fetch a
     * CI failure rather than a number in a log.
     */
    const KNOWN_RAW_HTTP_BASELINE = 10

    it('does not add new raw axios/fetch call sites', () => {
        const violations = sourceDirs.flatMap((dir) => {
            const scanDir = path.join(repoRoot, dir)
            return fs.existsSync(scanDir) ? findRawHttpUsage(scanDir) : []
        })

        if (violations.length > KNOWN_RAW_HTTP_BASELINE) {
            const detail = violations
                .slice(KNOWN_RAW_HTTP_BASELINE, KNOWN_RAW_HTTP_BASELINE + 15)
                .map((v) => `  ${v.file}:${v.line}  ${v.content.slice(0, 100)}`)
                .join('\n')
            expect.fail(
                `${violations.length} raw HTTP call sites, baseline is ${KNOWN_RAW_HTTP_BASELINE}. `
                + `New call sites must go through safeHttp.\n${detail}`,
            )
        }

        expect(violations.length).toBeLessThanOrEqual(KNOWN_RAW_HTTP_BASELINE)
    })

    it('the scanner actually detects the evasions it claims to', () => {
        // Proves the broadened matcher is not decorative: each of these would slip
        // past the original /\bfetch\(/ pattern.
        const probe = path.join(repoRoot, 'packages/server/api/src/app/__ssrf-probe.ts')
        fs.writeFileSync(probe, [
            'const a = fetch(url)',
            'const b = globalThis.fetch(url)',
            'const c = window.fetch(url)',
            'const f = fetch',
            'export { a, b, c, f }',
        ].join('\n'), 'utf-8')

        try {
            const found = findRawHttpUsage(path.join(repoRoot, 'packages/server/api/src/app'))
                .filter((v) => v.file.includes('__ssrf-probe'))

            expect(found.map((v) => v.line).sort()).toEqual([1, 2, 3, 4])
        }
        finally {
            fs.rmSync(probe, { force: true })
        }
    })

    it('leaves no probe file behind', () => {
        expect(fs.existsSync(path.join(repoRoot, 'packages/server/api/src/app/__ssrf-probe.ts'))).toBe(false)
    })
})
