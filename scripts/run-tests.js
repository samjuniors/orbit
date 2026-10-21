'use strict';

const { readdirSync } = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repositoryRoot = path.resolve(__dirname, '..');
const testDirectory = path.join(repositoryRoot, 'tests');

function discoverTests(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const entryPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        return discoverTests(entryPath);
      }

      return entry.isFile() && entry.name.endsWith('.test.js')
        ? [entryPath]
        : [];
    });
}

let testFiles;

try {
  testFiles = discoverTests(testDirectory);
} catch (error) {
  console.error(`Unable to discover tests in ${testDirectory}: ${error.message}`);
  process.exit(1);
}

if (testFiles.length === 0) {
  console.error(`No *.test.js files found in ${testDirectory}`);
  process.exit(1);
}

console.log(`Running ${testFiles.length} test file(s)...`);

const result = spawnSync(process.execPath, ['--test', ...testFiles], {
  cwd: repositoryRoot,
  stdio: 'inherit',
});

if (result.error) {
  console.error(`Failed to start the Node.js test runner: ${result.error.message}`);
  process.exit(1);
}

process.exitCode = result.status ?? 1;
