'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { inspectReleaseArtifacts, createReleaseMetadata } = require('../scripts/release-artifacts');

test('release artifacts are non-empty and receive SHA-256 digests', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-release-'));
  try {
    const filePath = path.join(dir, 'orbit.exe');
    fs.writeFileSync(filePath, 'release-binary');
    const [artifact] = inspectReleaseArtifacts([{ path: filePath, name: 'orbit.exe' }]);
    assert.equal(artifact.name, 'orbit.exe');
    assert.equal(artifact.size, 14);
    assert.match(artifact.sha256, /^[a-f0-9]{64}$/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('release artifact validation rejects missing and empty files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-release-'));
  try {
    const emptyPath = path.join(dir, 'empty.exe');
    fs.writeFileSync(emptyPath, '');
    assert.throws(
      () => inspectReleaseArtifacts([
        { path: path.join(dir, 'missing.exe'), name: 'missing.exe' },
        { path: emptyPath, name: 'empty.exe' }
      ]),
      /missing.exe[\s\S]*empty.exe/
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('release metadata records source commit and artifact checksums', () => {
  const result = createReleaseMetadata({
    tag: 'v0.7.0',
    commit: 'a'.repeat(40),
    nodeVersion: 'v22.0.0',
    platform: 'win32',
    architecture: 'x64',
    artifacts: [{ name: 'orbit.exe', size: 12, sha256: 'b'.repeat(64) }]
  });
  assert.match(result.checksumText, new RegExp('b{64}  orbit\\.exe'));
  const manifest = JSON.parse(result.manifestText);
  assert.equal(manifest.tag, 'v0.7.0');
  assert.equal(manifest.sourceCommit, 'a'.repeat(40));
  assert.equal(manifest.artifacts[0].size, 12);
});

test('release metadata rejects invalid tags, commits and empty artifact lists', () => {
  const base = {
    tag: 'v0.7.0',
    commit: 'a'.repeat(40),
    nodeVersion: 'v22.0.0',
    platform: 'win32',
    architecture: 'x64',
    artifacts: [{ name: 'orbit.exe', size: 12, sha256: 'b'.repeat(64) }]
  };
  assert.throws(() => createReleaseMetadata({ ...base, tag: 'latest' }), /Invalid canonical release tag/);
  assert.throws(() => createReleaseMetadata({ ...base, commit: 'short' }), /full 40-character Git SHA/);
  assert.throws(() => createReleaseMetadata({ ...base, artifacts: [] }), /At least one/);
});
