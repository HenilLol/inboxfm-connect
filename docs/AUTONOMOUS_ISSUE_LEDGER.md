# Autonomous Issue Ledger (OpenCode)

Agent: OpenCode. GitHub user: `HenilLol`. Upstream: `Mihir-Rabari/inboxfm-connect`, base `dev`.
No shared ledger exists in the repo, so this file tracks OpenCode reservations only.
Cross-agent visibility comes from inspecting local branches + `HenilLol/inboxfm-connect` refs.
NOTE (2026-09-29): a second agent works in the sibling worktree against the same fork and the
same issue pool. It owns the branches listed under "Other-agent work" below — do not touch them,
do not duplicate their issues.

## Dedup audit (2026-09-29, GitHub REST API + three-dot diffs per HenilLol branch)

HenilLol upstream PRs (all open, base `dev`): #272 (#131), #271 (#127), #270 (#126),
#268 (#141), #263 (#137), #261 (#125), #259 (#130), #240 (#155).
HenilLol branches and their actual files (via `git diff upstream/dev...branch --name-only`):
- fix/issue-130: piece-metadata controller + contract tests
- fix/issue-125: project-replace.service + legacy-flow tests
- test/issue-137: platform-analytics service/module + tests
- test/issue-126: replace plan-integrity test + service
- test/issue-127: replace MCP rotation test
- test/issue-128: replace e2e fixture test
- test/issue-131: stripe billing webhook test
- test/issue-141: core-execution flow-run + shared try-catch tests
- feature/issue-155: app-connection 404 + tests
NONE of these touch branch-condition schemas, openai/azure context code, notion users,
server outbound HTTP, knowledge-search, or bexio actions.
Merged upstream by others (never repeat): #156, #158, #162, #163, #165, #166, #171,
#176, #177, #182, #183, #190. Stale upstream (verified done): #134, #140, #142, #180.
Open competing PRs by others (avoid): #155 (Rakshit #236), #159, #160, #164, #169, #170,
#172, #173, #174, #175, #187, #188, #189.

## Other-agent work observed in this repo (same fork, do not touch)

Local + pushed branches owned by the sibling agent (all authored 2026-09-29, same git user):
fix/issue-158, fix/issue-159, fix/issue-161, fix/issue-162, fix/issue-165, fix/issue-166,
fix/issue-167, fix/issue-168-flow-import-branch-conditions-validation, fix/issue-169,
fix/issue-170, fix/issue-171, fix/issue-172, fix/issue-174, fix/issue-175, fix/issue-176,
fix/issue-185-bexio-endpoints-error-handling, fix/issue-187, fix/issue-325, fix/issue-326,
test/issue-129, test/issue-132, test/issue-139, test/issue-146.
COLLISIONS: #168 (theirs: validation variant, pushed) and #185 (theirs: common/props.ts
account/tax endpoints, pushed as fix/issue-185-bexio-endpoints-error-handling@7e112c20e6;
mine: actions' five endpoints, pushed as fix/issue-185-bexio-endpoint-failures@d9d4e7e221).
The two #185 branches touch different files and are complementary.

## Abandoned: Issue #168 (per user request)

- OpenCode implemented strict ValidBranchCondition import validation on
  fix/issue-168-import-flow-strict-branch-conditions@ca13b6b3884 (pushed, 9 unit tests green,
  verified failing pre-fix). User declined the PR (duplicate). Branch left pushed but unreported
  for PR creation. The sibling agent also has fix/issue-168-flow-import-branch-conditions-validation.
- Prior session's fix/issue-156 branch is a stale duplicate of merged upstream PR #223; untouched.

## PR1 — Issue #184: OpenAI/Azure reduceContextSize discards recursion, mutates input — PUSHED

- Branch: fix/issue-184-reduce-context-size-recursion. Commit: 9b12375c23092d169354dcdc3828d3912b3a37e2.
- Files: openai common.ts + azure common/index.ts (copy-on-write iterative cutoff loop),
  both package.json (+test script), both vitest.config.ts, both test/common.test.ts (4 tests each).
- Verification: 4+4 vitest green; all 8 fail pre-fix (stash check); tsc --noEmit exit 0 both;
  eslint 0 errors; callers use return value (compatible).
- URL: https://github.com/Mihir-Rabari/inboxfm-connect/compare/dev...HenilLol:inboxfm-connect:fix/issue-184-reduce-context-size-recursion?expand=1

## PR2 — Issue #186: Notion people dropdowns capped at 100 — PUSHED

- Branch: fix/issue-186-notion-people-pagination. Commit: 47112c7c309ac68adcf2480083a1543622809d42.
- Files: notion common/index.ts (listAllWorkspaceUsers via SDK collectPaginatedAPI, both call
  sites), package.json, vitest.config.ts, test/common.test.ts (3 tests).
- Verification: 3 vitest green; tsc exit 0; eslint shows only pre-existing CRLF debt (file is
  CRLF at HEAD) plus pre-existing any-warnings; my hunks add no new issues.
- URL: https://github.com/Mihir-Rabari/inboxfm-connect/compare/dev...HenilLol:inboxfm-connect:fix/issue-186-notion-people-pagination?expand=1

## PR3 — Issue #143: SSRF guard enforcement — PUSHED

- Branch: fix/issue-143-ssrf-guard-enforcement. Commit: 9f475eb130ade7b72b3e240e1e0c8eb1887b8881.
- Files: openrouter-api.ts, license-keys-service.ts, google-authn-provider.ts migrated to
  safeHttp (validateStatus:true, status/data mapping preserved); ap-version.ts migrated;
  api/test/unit/app/security/ssrf-guard.test.ts (repo scan + allowlist exactness);
  api openrouter-api.test.ts (5 tests) + license-keys-service.test.ts (6 tests, mocked seam);
  utils/test/ssrf-guard.test.ts (7 edge tests: decimal/octal/hex/IPv4-mapped/0.0.0.0 + redirect).
- Verification: 11 migration tests + 2 scan + 7 edge + 29 utils (ap-version/safe-http/guard) green;
  entity-registration suite still green; lint parity with baseline (2 pre-existing errors in
  license file untouched); file-system-utils failures pre-exist on Windows (verified via stash).
- Left raw (allowlisted, documented): newsletter call (pending #235), engine/sandbox internal calls.
- URL: https://github.com/Mihir-Rabari/inboxfm-connect/compare/dev...HenilLol:inboxfm-connect:fix/issue-143-ssrf-guard-enforcement?expand=1

## PR4 — Issue #138: knowledge-search coverage — PUSHED

- Branch: test/issue-138-knowledge-search-coverage. Commit: 978bb6efedde5fa69053d8df6d9073e06705dab4.
- Files: test/unit/app/knowledge-search/knowledge-search.service.test.ts (5 mocked mapping tests),
  test/integration/ce/knowledge-search/knowledge-search.test.ts (3 endpoint tests, PGlite).
- Note: tool-search.test.ts already covers the service against a real DB; these add mapping/
  limit/mode/validation cases. Old knowledge-base/ dir kept (its tests target file deletion +
  zod validation, not search — moving them would mislabel).
- Verification: 5 unit + 3 integration green; eslint 0 errors.
- URL: https://github.com/Mihir-Rabari/inboxfm-connect/compare/dev...HenilLol:inboxfm-connect:test/issue-138-knowledge-search-coverage?expand=1

## PR5 — Issue #185: Bexio endpoints — PUSHED (see collision note above)

- Branch: fix/issue-185-bexio-endpoint-failures. Commit: d9d4e7e221dd3ccdc988ce3d85ecd8f86539a92b.
- Endpoint verification vs official docs (docs.bexio.com HTML scan): GET /2.0/timesheet_status,
  /2.0/client_service, /2.0/stock, /2.0/stock_place all exist; /2.0/article_group does NOT
  (only an article_group_id field) — dropdown replaced with Number input in create-product
  and update-product; all five `.catch(() => [])` removed so failures reach the existing
  disabled diagnostic placeholders.
- Files: 3 action files + package.json/vitest.config/test/actions.test.ts (6 tests).
- Verification: 6 vitest green; tsc exit 0; eslint 0 errors (pre-existing warnings only).
- URL: https://github.com/Mihir-Rabari/inboxfm-connect/compare/dev...HenilLol:inboxfm-connect:fix/issue-185-bexio-endpoint-failures?expand=1
