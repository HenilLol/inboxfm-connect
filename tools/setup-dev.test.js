const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  assertSupportedNodeVersion,
  findAllPieceFolders,
  resolveDevPieceFilters,
  resolveIntegrationsRoot,
} = require('./setup-dev');

test('assertSupportedNodeVersion accepts the supported majors', () => {
  for (const version of ['v18.1.0', 'v22.14.0', 'v24.1.0']) {
    assert.doesNotThrow(() => assertSupportedNodeVersion({ version }));
  }
});

test('assertSupportedNodeVersion rejects anything else with a clear message', () => {
  assert.throws(
    () => assertSupportedNodeVersion({ version: 'v20.11.0' }),
    /Node\.js version is not compatible\. Required version: /,
  );
});

test('resolveIntegrationsRoot fails with a clear error when the directory is missing', () => {
  const missing = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'setup-dev-')), 'nope');
  assert.throws(
    () => resolveIntegrationsRoot({ cwd: missing }),
    /Integrations directory not found at .*packages[\\/]integrations.*repository root/,
  );
});

test('resolveIntegrationsRoot returns the integrations directory when present', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-dev-'));
  fs.mkdirSync(path.join(root, 'packages', 'integrations'), { recursive: true });
  assert.equal(
    resolveIntegrationsRoot({ cwd: root }),
    path.resolve(root, 'packages', 'integrations'),
  );
});

test('resolveDevPieceFilters maps piece names to turbo filters across groups', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-dev-'));
  const community = path.join(root, 'packages', 'integrations', 'community', 'store');
  const core = path.join(root, 'packages', 'integrations', 'core', 'http');
  fs.mkdirSync(community, { recursive: true });
  fs.mkdirSync(core, { recursive: true });
  fs.writeFileSync(path.join(community, 'package.json'), JSON.stringify({ name: '@inboxfm-connect/piece-store' }));
  fs.writeFileSync(path.join(core, 'package.json'), JSON.stringify({ name: '@inboxfm-connect/piece-http' }));

  const integrationsRoot = resolveIntegrationsRoot({ cwd: root });
  const folders = findAllPieceFolders(integrationsRoot);
  assert.ok(folders.some((folder) => folder.endsWith(`${path.sep}store`)));
  assert.equal(
    resolveDevPieceFilters({ devPieces: 'store, http', integrationsRoot }),
    '--filter=@inboxfm-connect/piece-store --filter=@inboxfm-connect/piece-http',
  );
});

test('resolveDevPieceFilters names the missing piece', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-dev-'));
  const integrationsRoot = path.join(root, 'packages', 'integrations');
  fs.mkdirSync(integrationsRoot, { recursive: true });
  assert.throws(
    () => resolveDevPieceFilters({ devPieces: 'nope', integrationsRoot }),
    /Piece folder not found for: "nope"/,
  );
});
