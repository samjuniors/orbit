'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateReleaseMetadata } = require('../scripts/validate-release');

const valid = {
  packageVersion: '0.7.0',
  lockVersion: '0.7.0',
  changelog: '# Changelog\n\n## [Unreleased]\n- Next\n\n## [0.7.0] - Preview\n',
  expectedTag: 'v0.7.0',
  tagsAtHead: ['v0.7.0']
};

test('release metadata accepts matching package, lockfile, tag and changelog versions', () => {
  assert.deepEqual(validateReleaseMetadata(valid), { version: '0.7.0', tag: 'v0.7.0' });
});

test('release metadata rejects a package-lock version mismatch', () => {
  assert.throws(
    () => validateReleaseMetadata({ ...valid, lockVersion: '0.6.0' }),
    /package-lock.json version/
  );
});

test('release metadata rejects a tag that differs from the canonical package version', () => {
  assert.throws(
    () => validateReleaseMetadata({ ...valid, expectedTag: 'v0.8.0' }),
    /Expected release tag/
  );
});

test('release metadata requires the canonical Git tag at HEAD', () => {
  assert.throws(
    () => validateReleaseMetadata({ ...valid, tagsAtHead: [] }),
    /must point at the current commit/
  );
});

test('release metadata rejects a changelog heading that differs from package version', () => {
  assert.throws(
    () => validateReleaseMetadata({
      ...valid,
      changelog: '# Changelog\n\n## [Unreleased]\n- Next\n\n## [0.6.0] - Old\n'
    }),
    /Latest CHANGELOG.md version/
  );
});

test('release metadata rejects missing release headings and non-stable versions', () => {
  assert.throws(
    () => validateReleaseMetadata({ ...valid, changelog: '# Changelog\n## [Unreleased]\n' }),
    /no released version heading/
  );
  assert.throws(
    () => validateReleaseMetadata({ ...valid, packageVersion: '1.0.0-beta.1', expectedTag: 'v1.0.0-beta.1' }),
    /not a stable MAJOR.MINOR.PATCH/
  );
});
