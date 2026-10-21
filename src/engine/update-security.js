'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');

const TRUSTED_DOWNLOAD_HOSTS = new Set(['github.com', 'release-assets.githubusercontent.com']);

function assertHttpsUrl(value, label = 'asset URL') {
  let url;
  try { url = new URL(value); } catch { throw new Error(`Invalid ${label}.`); }
  if (url.protocol !== 'https:' || url.username || url.password || !TRUSTED_DOWNLOAD_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error(`Untrusted ${label}; expected HTTPS from GitHub Releases.`);
  }
  return url;
}

function validateReleaseAsset(asset, expectedName, tag) {
  if (!asset || asset.name !== expectedName || !Number.isSafeInteger(asset.size) || asset.size <= 0) {
    throw new Error(`Invalid or missing release asset: ${expectedName}`);
  }
  const url = assertHttpsUrl(asset.downloadUrl, 'release asset URL');
  if (!url.pathname.includes(`/releases/download/${encodeURIComponent(tag)}/`)) {
    throw new Error(`Release asset URL does not match release tag ${tag}.`);
  }
  return asset;
}

function validateManifestEntry(manifest, { tag, assetName, assetSize }) {
  if (!manifest || manifest.schemaVersion !== 1 || manifest.tag !== tag || !/^[a-f0-9]{40}$/i.test(manifest.sourceCommit || '') || !Array.isArray(manifest.artifacts)) {
    throw new Error('Release manifest is invalid or does not match the selected release.');
  }
  const entries = manifest.artifacts.filter(item => item && item.name === assetName);
  if (entries.length !== 1) throw new Error(`Release manifest must contain exactly one entry for ${assetName}.`);
  const entry = entries[0];
  if (!Number.isSafeInteger(entry.size) || entry.size <= 0 || entry.size !== assetSize ||
      typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(entry.sha256)) {
    throw new Error(`Release manifest metadata is invalid for ${assetName}.`);
  }
  return entry;
}

async function downloadVerifiedAsset({ asset, manifestEntry, fetchFn = globalThis.fetch }) {
  assertHttpsUrl(asset.downloadUrl, 'release asset URL');
  const response = await fetchFn(asset.downloadUrl, { headers: { 'User-Agent': 'orbit-cli' } });
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status} ${response.statusText || ''}`.trim());
  if (response.url) assertHttpsUrl(response.url, 'final download URL');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length !== asset.size || bytes.length !== manifestEntry.size) {
    throw new Error(`Downloaded asset size mismatch for ${asset.name}.`);
  }
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  if (digest.toLowerCase() !== manifestEntry.sha256.toLowerCase()) {
    throw new Error(`SHA-256 verification failed for ${asset.name}.`);
  }
  return bytes;
}

function writeVerifiedDownload(filePath, bytes) {
  fs.writeFileSync(filePath, bytes, { flag: 'wx', mode: 0o700 });
}

function replaceWithRollback({ newPath, currentPath, backupPath, rename = fs.renameSync, exists = fs.existsSync, remove = fs.unlinkSync, healthCheck }) {
  if (exists(backupPath)) remove(backupPath);
  rename(currentPath, backupPath);
  try {
    rename(newPath, currentPath);
    if (healthCheck && !healthCheck(currentPath)) throw new Error('Updated executable failed its health check.');
  } catch (error) {
    try {
      if (exists(currentPath)) remove(currentPath);
      rename(backupPath, currentPath);
    } catch (rollbackError) {
      throw new Error(`Update failed (${error.message}); rollback also failed (${rollbackError.message}). Previous executable remains at ${backupPath}.`);
    }
    throw error;
  }
  try { remove(backupPath); } catch {}
  return true;
}

module.exports = {
  assertHttpsUrl,
  validateReleaseAsset,
  validateManifestEntry,
  downloadVerifiedAsset,
  writeVerifiedDownload,
  replaceWithRollback
};
