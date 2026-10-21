const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  parseSemver,
  compareSemver,
  isNewer,
  checkUpdate,
  runUpdateCommand,
  getUpdateNotice,
  writeCache
} = require('../src/engine/update');

test('parseSemver and compareSemver', () => {
  assert.deepEqual(parseSemver('0.7.0'), [0, 7, 0]);
  assert.deepEqual(parseSemver('v1.2.3'), [1, 2, 3]);
  assert.equal(parseSemver('invalid'), null);

  assert.equal(compareSemver('0.7.0', '0.7.0'), 0);
  assert.equal(compareSemver('0.8.0', '0.7.0'), 1);
  assert.equal(compareSemver('0.6.9', '0.7.0'), -1);
  assert.equal(compareSemver('1.0.0', '0.9.9'), 1);
  assert.equal(compareSemver('0.7.1', '0.7.0'), 1);

  assert.equal(isNewer('0.8.0', '0.7.0'), true);
  assert.equal(isNewer('0.7.0', '0.7.0'), false);
  assert.equal(isNewer('0.6.0', '0.7.0'), false);
});

test('checkUpdate with mock fetch: update available', async () => {
  const mockFetch = async (url) => {
    if (url.includes('/releases/latest')) {
      return {
        ok: true,
        json: async () => ({
          tag_name: 'v0.8.0',
          html_url: 'https://github.com/samjuniors/orbit/releases/tag/v0.8.0',
          body: 'Fixes and new features in v0.8.0',
          assets: [
            { name: 'orbit.exe', browser_download_url: 'https://github.com/samjuniors/orbit/releases/download/v0.8.0/orbit.exe', size: 1000 }
          ]
        })
      };
    }
    return { ok: false, status: 404 };
  };

  const res = await checkUpdate({
    currentVersion: '0.7.0',
    force: true,
    fetchFn: mockFetch
  });

  assert.equal(res.updateAvailable, true);
  assert.equal(res.currentVersion, '0.7.0');
  assert.equal(res.latestVersion, '0.8.0');
  assert.equal(res.releaseUrl, 'https://github.com/samjuniors/orbit/releases/tag/v0.8.0');
  assert.equal(res.assets.length, 1);
  assert.equal(res.assets[0].name, 'orbit.exe');
});

test('checkUpdate with mock fetch: already up to date', async () => {
  const mockFetch = async () => ({
    ok: true,
    json: async () => ({
      tag_name: 'v0.7.0',
      html_url: 'https://github.com/samjuniors/orbit/releases/tag/v0.7.0',
      body: 'Current release',
      assets: []
    })
  });

  const res = await checkUpdate({
    currentVersion: '0.7.0',
    force: true,
    fetchFn: mockFetch
  });

  assert.equal(res.updateAvailable, false);
  assert.equal(res.latestVersion, '0.7.0');
});

test('getUpdateNotice reads cached state', () => {
  writeCache({
    checkedAt: Date.now(),
    currentVersion: '0.6.0',
    latestVersion: '0.7.0',
    updateAvailable: true,
    releaseUrl: 'https://github.com/samjuniors/orbit/releases/tag/v0.7.0'
  });

  const notice = getUpdateNotice('0.6.0');
  assert.match(notice, /Update available: v0.6.0 -> v0.7.0/);

  // When up to date, notice is null
  const noNotice = getUpdateNotice('0.7.0');
  assert.equal(noNotice, null);
});

test('runUpdateCommand checkOnly returns exit code 2 when update available', async () => {
  writeCache({
    checkedAt: Date.now(),
    currentVersion: '0.6.0',
    latestVersion: '0.7.0',
    updateAvailable: true,
    releaseUrl: 'https://github.com/samjuniors/orbit/releases/tag/v0.7.0',
    releaseNotes: 'Some notes'
  });

  const logs = [];
  const code = await runUpdateCommand({
    currentVersion: '0.6.0',
    checkOnly: true,
    force: false,
    say: m => logs.push(m)
  });

  assert.equal(code, 2);
  assert.ok(logs.some(l => l.includes('Update available')));
});
