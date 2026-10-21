'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const pkg = require('../package.json');
const trayPkg = require('../apps/tray/package.json');
const { inspectReleaseArtifacts, createReleaseMetadata } = require('./release-artifacts');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const files = [
  { path: path.join(dist, `Orbit-Desktop-Setup-${trayPkg.version}.exe`), name: `Orbit-Desktop-Setup-${trayPkg.version}.exe` },
  { path: path.join(dist, `Orbit-Setup-${pkg.version}.exe`), name: `Orbit-Setup-${pkg.version}.exe` },
  { path: path.join(dist, 'orbit.exe'), name: 'orbit.exe' }
];

try {
  const tag = `v${pkg.version}`;
  const commit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  if (commit.status !== 0) throw new Error('Could not resolve source commit.');
  const artifacts = inspectReleaseArtifacts(files);
  const metadata = createReleaseMetadata({
    tag,
    commit: commit.stdout.trim(),
    nodeVersion: process.version,
    platform: process.platform,
    architecture: process.arch,
    artifacts
  });
  fs.writeFileSync(path.join(dist, 'SHA256SUMS.txt'), metadata.checksumText);
  fs.writeFileSync(path.join(dist, 'release-manifest.json'), metadata.manifestText);
  console.log(`Validated ${artifacts.length} release artifacts and generated SHA-256/provenance metadata for ${tag}.`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
