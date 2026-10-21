'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const trayPackage = require('../apps/tray/package.json');
const versionedName = `Orbit-Desktop-Setup-${trayPackage.version}.exe`;
const source = path.join(root, 'apps', 'tray', 'release', versionedName);
const dist = path.join(root, 'dist');
const destination = path.join(dist, versionedName);

if (!fs.existsSync(source)) {
  console.error(`Desktop installer not found: ${source}`);
  console.error('Build it first with: npm --prefix apps/tray run dist:win');
  process.exit(1);
}

fs.mkdirSync(dist, { recursive: true });
fs.copyFileSync(source, destination);
console.log(`Copied desktop installer for version ${trayPackage.version} to ${destination}`);
