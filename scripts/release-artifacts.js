'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');

function inspectReleaseArtifacts(files) {
  const inspected = [];
  const errors = [];
  for (const file of files) {
    let stats;
    try {
      stats = fs.statSync(file.path);
    } catch {
      errors.push(`Required release asset is missing: ${file.name}`);
      continue;
    }
    if (!stats.isFile() || stats.size <= 0) {
      errors.push(`Required release asset is empty or not a file: ${file.name}`);
      continue;
    }
    const sha256 = crypto.createHash('sha256').update(fs.readFileSync(file.path)).digest('hex');
    inspected.push({ name: file.name, path: file.path, size: stats.size, sha256 });
  }
  if (errors.length) throw new Error(`Release artifact validation failed:\n- ${errors.join('\n- ')}`);
  return inspected;
}

function createReleaseMetadata({ tag, commit, nodeVersion, platform, artifacts }) {
  if (!/^v(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)$/.test(tag || '')) {
    throw new Error(`Invalid canonical release tag: ${tag}`);
  }
  if (!/^[0-9a-f]{40}$/i.test(commit || '')) {
    throw new Error('Release source commit must be a full 40-character Git SHA.');
  }
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    throw new Error('At least one validated release artifact is required.');
  }
  const checksumText = artifacts.map(a => `${a.sha256}  ${a.name}`).join('\n') + '\n';
  const manifest = {
    schemaVersion: 1,
    tag,
    sourceCommit: commit,
    build: { nodeVersion, platform },
    artifacts: artifacts.map(({ name, size, sha256 }) => ({ name, size, sha256 }))
  };
  return { checksumText, manifestText: JSON.stringify(manifest, null, 2) + '\n' };
}

module.exports = { inspectReleaseArtifacts, createReleaseMetadata };
