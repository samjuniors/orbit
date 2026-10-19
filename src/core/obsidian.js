const fs = require('node:fs');
const path = require('node:path');
const { findObsidianVaults } = require('./discovery');

function listDiscoveredVaults(customConfigPath) {
  return findObsidianVaults(customConfigPath);
}

function validateVault(vaultPath) {
  if (!vaultPath || typeof vaultPath !== 'string') {
    throw new Error('Obsidian vault path must be a non-empty string.');
  }

  const resolved = path.resolve(vaultPath.trim());
  if (!fs.existsSync(resolved)) {
    throw new Error(`The folder "${resolved}" does not exist.`);
  }

  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) {
    throw new Error(`The path "${resolved}" is a file, not a directory.`);
  }

  try {
    fs.accessSync(resolved, fs.constants.R_OK);
  } catch {
    throw new Error(`The vault folder "${resolved}" is not readable.`);
  }

  const hasObsidianConfig = fs.existsSync(path.join(resolved, '.obsidian'));
  const vaultName = path.basename(resolved);

  return {
    valid: true,
    name: vaultName,
    path: resolved,
    hasObsidianConfig,
    readOnly: true
  };
}

function readNoteSafe(vaultPath, relativeNotePath) {
  const validated = validateVault(vaultPath);
  if (!relativeNotePath || typeof relativeNotePath !== 'string') {
    throw new Error('Note path must be specified.');
  }

  const targetPath = path.resolve(validated.path, relativeNotePath);
  // Prevent path traversal outside vault
  if (!targetPath.startsWith(validated.path)) {
    throw new Error('Access denied: note path escapes the Obsidian vault root.');
  }

  if (!fs.existsSync(targetPath)) {
    throw new Error(`Note "${relativeNotePath}" not found in vault.`);
  }

  return fs.readFileSync(targetPath, 'utf8');
}

module.exports = {
  listDiscoveredVaults,
  validateVault,
  readNoteSafe
};
