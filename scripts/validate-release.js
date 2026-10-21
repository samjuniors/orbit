'use strict';

function validateReleaseMetadata({ packageVersion, lockVersion, changelog, expectedTag, tagsAtHead }) {
  const errors = [];
  const stableSemver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

  if (!stableSemver.test(packageVersion || '')) {
    errors.push(`package.json version "${packageVersion}" is not a stable MAJOR.MINOR.PATCH version.`);
  }
  if (lockVersion !== packageVersion) {
    errors.push(`package-lock.json version "${lockVersion}" does not match package.json "${packageVersion}".`);
  }

  const canonicalTag = `v${packageVersion}`;
  if (expectedTag !== canonicalTag) {
    errors.push(`Expected release tag "${canonicalTag}", received "${expectedTag}".`);
  }
  if (!Array.isArray(tagsAtHead) || !tagsAtHead.includes(canonicalTag)) {
    errors.push(`Git tag "${canonicalTag}" must point at the current commit before release validation.`);
  }

  const changelogVersion = changelog
    ? changelog.match(/^## \[(\d+\.\d+\.\d+)\](?:\s|$)/m)?.[1]
    : null;
  if (!changelogVersion) {
    errors.push('CHANGELOG.md has no released version heading.');
  } else if (changelogVersion !== packageVersion) {
    errors.push(`Latest CHANGELOG.md version "${changelogVersion}" does not match package.json "${packageVersion}".`);
  }

  if (errors.length) {
    throw new Error(`Release version validation failed:\n- ${errors.join('\n- ')}`);
  }

  return { version: packageVersion, tag: canonicalTag };
}

module.exports = { validateReleaseMetadata };

if (require.main === module) {
  const fs = require('node:fs');
  const path = require('node:path');
  const { spawnSync } = require('node:child_process');
  const root = path.resolve(__dirname, '..');
  const pkg = require('../package.json');
  const lock = require('../package-lock.json');
  const tagResult = spawnSync('git', ['tag', '--points-at', 'HEAD'], {
    cwd: root,
    encoding: 'utf8'
  });

  if (tagResult.status !== 0) {
    console.error('Could not read Git tags at HEAD. Run this command from a Git checkout.');
    process.exit(1);
  }

  try {
    const result = validateReleaseMetadata({
      packageVersion: pkg.version,
      lockVersion: lock.version,
      changelog: fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'),
      expectedTag: `v${pkg.version}`,
      tagsAtHead: tagResult.stdout.split(/\r?\n/).filter(Boolean)
    });
    console.log(`Release metadata is consistent: ${result.tag}`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
