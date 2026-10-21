'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  assertHttpsUrl, validateReleaseAsset, validateManifestEntry,
  downloadVerifiedAsset, replaceWithRollback
} = require('../src/engine/update-security');

const bytes = Buffer.from('trusted ORBIT executable');
const digest = crypto.createHash('sha256').update(bytes).digest('hex');
const asset = {
  name: 'orbit.exe',
  size: bytes.length,
  downloadUrl: 'https://github.com/samjuniors/orbit/releases/download/v0.8.0/orbit.exe'
};
const entry = { name: 'orbit.exe', size: bytes.length, sha256: digest };
const manifest = { schemaVersion: 1, tag: 'v0.8.0', sourceCommit: 'a'.repeat(40), artifacts: [entry] };

test('accepts only HTTPS URLs on approved GitHub download hosts', () => {
  assert.equal(assertHttpsUrl(asset.downloadUrl).hostname, 'github.com');
  assert.throws(() => assertHttpsUrl('http://github.com/file'), /HTTPS/);
  assert.throws(() => assertHttpsUrl('https://example.com/file'), /HTTPS/);
});

test('validates asset identity and release tag', () => {
  assert.equal(validateReleaseAsset(asset, 'orbit.exe', 'v0.8.0'), asset);
  assert.throws(() => validateReleaseAsset(asset, 'other.exe', 'v0.8.0'), /Invalid/);
  assert.throws(() => validateReleaseAsset(asset, 'orbit.exe', 'v0.9.0'), /tag/);
});

test('requires matching trusted release manifest entry', () => {
  assert.deepEqual(validateManifestEntry(manifest, { tag: 'v0.8.0', assetName: 'orbit.exe', assetSize: bytes.length }), entry);
  assert.throws(() => validateManifestEntry(manifest, { tag: 'v0.9.0', assetName: 'orbit.exe', assetSize: bytes.length }), /does not match/);
  assert.throws(() => validateManifestEntry(manifest, { tag: 'v0.8.0', assetName: 'orbit.exe', assetSize: bytes.length + 1 }), /invalid/);
});

test('rejects corrupted or incomplete downloads before installation', async () => {
  const goodFetch = async url => ({ ok: true, url, arrayBuffer: async () => bytes });
  assert.deepEqual(await downloadVerifiedAsset({ asset, manifestEntry: entry, fetchFn: goodFetch }), bytes);
  const corruptFetch = async url => ({ ok: true, url, arrayBuffer: async () => Buffer.from('tampered') });
  await assert.rejects(downloadVerifiedAsset({ asset, manifestEntry: entry, fetchFn: corruptFetch }), /size mismatch|SHA-256/);
  const failedFetch = async url => ({ ok: false, status: 503, statusText: 'Unavailable' });
  await assert.rejects(downloadVerifiedAsset({ asset, manifestEntry: entry, fetchFn: failedFetch }), /HTTP 503/);
});

test('rolls back when replacement health check fails', () => {
  const files = new Map([['current', 'old'], ['download', 'new']]);
  const exists = p => files.has(p);
  const rename = (from, to) => { if (!files.has(from)) throw new Error('missing'); files.set(to, files.get(from)); files.delete(from); };
  const remove = p => files.delete(p);
  assert.throws(() => replaceWithRollback({
    newPath: 'download', currentPath: 'current', backupPath: 'backup',
    exists, rename, remove, healthCheck: () => false
  }), /health check/);
  assert.equal(files.get('current'), 'old');
  assert.equal(files.has('backup'), false);
});

test('keeps a recovery backup if rollback itself fails', () => {
  const files = new Map([['current', 'old'], ['download', 'new']]);
  const exists = p => files.has(p);
  const rename = (from, to) => {
    if (from === 'backup' && to === 'current') throw new Error('disk error');
    if (!files.has(from)) throw new Error('missing');
    files.set(to, files.get(from)); files.delete(from);
  };
  const remove = p => files.delete(p);
  assert.throws(() => replaceWithRollback({
    newPath: 'download', currentPath: 'current', backupPath: 'backup',
    exists, rename, remove, healthCheck: () => false
  }), /rollback also failed/);
  assert.equal(files.get('backup'), 'old');
});
