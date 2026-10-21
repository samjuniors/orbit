const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync, spawn } = require('node:child_process');

const REPO_OWNER = 'samjuniors';
const REPO_NAME = 'orbit';
const DEFAULT_TIMEOUT_MS = 6000;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

function parseSemver(v) {
  if (typeof v !== 'string') return null;
  const m = v.trim().replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function compareSemver(v1, v2) {
  const p1 = parseSemver(v1);
  const p2 = parseSemver(v2);
  if (!p1 && !p2) return 0;
  if (!p1) return -1;
  if (!p2) return 1;
  for (let i = 0; i < 3; i++) {
    if (p1[i] > p2[i]) return 1;
    if (p1[i] < p2[i]) return -1;
  }
  return 0;
}

function isNewer(candidate, current) {
  return compareSemver(candidate, current) > 0;
}

function getCachePath() {
  return path.join(os.homedir(), '.orbit', 'update-cache.json');
}

function readCache() {
  try {
    const raw = fs.readFileSync(getCachePath(), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeCache(data) {
  try {
    const cp = getCachePath();
    fs.mkdirSync(path.dirname(cp), { recursive: true });
    fs.writeFileSync(cp, JSON.stringify(data, null, 2));
  } catch {}
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await (opts.fetchFn || globalThis.fetch)(url, {
      ...opts,
      signal: controller.signal,
      headers: {
        'User-Agent': 'orbit-cli',
        Accept: 'application/vnd.github+json',
        ...(opts.headers || {})
      }
    });
    return res;
  } finally {
    clearTimeout(t);
  }
}

async function fetchLatestReleaseInfo({ fetchFn = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  // 1. Try GitHub Releases API first
  try {
    const relRes = await fetchWithTimeout(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`,
      { fetchFn },
      timeoutMs
    );
    if (relRes.ok) {
      const data = await relRes.json();
      const tag = data.tag_name || data.name || '';
      const version = tag.replace(/^v/, '');
      if (parseSemver(version)) {
        const assets = (data.assets || []).map(a => ({
          name: a.name,
          downloadUrl: a.browser_download_url,
          size: a.size
        }));
        return {
          version,
          tag,
          releaseUrl: data.html_url || `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/tag/${tag}`,
          releaseNotes: data.body || '',
          assets,
          publishedAt: data.published_at || new Date().toISOString()
        };
      }
    }
  } catch {}

  // 2. Fallback to tags if releases API doesn't have an official release yet
  try {
    const tagsRes = await fetchWithTimeout(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/tags`,
      { fetchFn },
      timeoutMs
    );
    if (tagsRes.ok) {
      const tags = await tagsRes.json();
      if (Array.isArray(tags) && tags.length > 0) {
        // Find highest semver tag
        let highest = null;
        for (const t of tags) {
          const v = t.name.replace(/^v/, '');
          if (parseSemver(v)) {
            if (!highest || compareSemver(v, highest) > 0) highest = v;
          }
        }
        if (highest) {
          return {
            version: highest,
            tag: `v${highest}`,
            releaseUrl: `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/tag/v${highest}`,
            releaseNotes: '',
            assets: [],
            publishedAt: new Date().toISOString()
          };
        }
      }
    }
  } catch {}

  // 3. Fallback to raw package.json on main
  try {
    const rawRes = await fetchWithTimeout(
      `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/main/package.json`,
      { fetchFn },
      timeoutMs
    );
    if (rawRes.ok) {
      const pkg = await rawRes.json();
      if (pkg.version && parseSemver(pkg.version)) {
        return {
          version: pkg.version,
          tag: `v${pkg.version}`,
          releaseUrl: `https://github.com/${REPO_OWNER}/${REPO_NAME}`,
          releaseNotes: '',
          assets: [],
          publishedAt: new Date().toISOString()
        };
      }
    }
  } catch {}

  throw new Error('Unable to reach GitHub to check for updates (network error or repository not found).');
}

async function checkUpdate({
  currentVersion,
  force = false,
  cacheTtlMs = CACHE_TTL_MS,
  fetchFn = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS
}) {
  if (!force) {
    const cached = readCache();
    if (cached && Date.now() - (cached.checkedAt || 0) < cacheTtlMs) {
      return {
        ...cached,
        currentVersion,
        updateAvailable: isNewer(cached.latestVersion, currentVersion),
        fromCache: true
      };
    }
  }

  const info = await fetchLatestReleaseInfo({ fetchFn, timeoutMs });
  const updateAvailable = isNewer(info.version, currentVersion);

  const result = {
    checkedAt: Date.now(),
    currentVersion,
    latestVersion: info.version,
    tag: info.tag,
    releaseUrl: info.releaseUrl,
    releaseNotes: info.releaseNotes,
    assets: info.assets,
    updateAvailable,
    fromCache: false
  };

  writeCache(result);
  return result;
}

function getExecutionMode() {
  try {
    const sea = require('node:sea');
    if (sea.isSea()) return 'binary';
  } catch {}
  if (process.execPath.toLowerCase().endsWith('orbit.exe')) return 'binary';
  const root = path.resolve(__dirname, '..', '..');
  if (fs.existsSync(path.join(root, '.git'))) return 'git';
  return 'npm';
}

function cleanupOldBinaries() {
  // Never delete a retained backup automatically: it may be the only recovery
  // copy after a failed rollback. Successful updates remove their backup only
  // after the replacement executable passes its health check.
  return false;
}

async function downloadBinary(url, destPath, options = {}) {
  const { downloadVerifiedAsset, writeVerifiedDownload } = require('./update-security');
  const bytes = await downloadVerifiedAsset(options);
  writeVerifiedDownload(destPath, bytes);
}

function replaceBinary(newBinaryPath, currentBinaryPath = process.execPath, expectedVersion) {
  if (process.platform === 'win32') {
    const { scheduleWindowsReplacement } = require('./windows-update');
    return scheduleWindowsReplacement({
      newPath: newBinaryPath,
      currentPath: currentBinaryPath,
      expectedVersion,
      parentPid: process.pid
    });
  }
  const { replaceWithRollback } = require('./update-security');
  fs.chmodSync(newBinaryPath, 0o755);
  return replaceWithRollback({
    newPath: newBinaryPath,
    currentPath: currentBinaryPath,
    backupPath: currentBinaryPath + '.old',
    healthCheck: filePath => {
      const check = spawnSync(filePath, ['--version'], { encoding: 'utf8', timeout: 10000 });
      return check.status === 0 && (check.stdout || '').trim() === expectedVersion;
    }
  });
}

function getUpdateNotice(currentVersion) {
  try {
    const c = readCache();
    if (c && c.latestVersion && isNewer(c.latestVersion, currentVersion)) {
      return `\n* Update available: v${currentVersion} -> v${c.latestVersion}. Run 'orbit update' to upgrade.`;
    }
  } catch {}
  return null;
}

function triggerBackgroundCheck(currentVersion) {
  const c = readCache();
  if (c && Date.now() - (c.checkedAt || 0) < CACHE_TTL_MS) return;
  // Fire and forget
  checkUpdate({ currentVersion, timeoutMs: 3000 }).catch(() => {});
}

async function runUpdateCommand({
  currentVersion,
  checkOnly = false,
  yes = false,
  force = true,
  ask,
  say = console.log,
  fetchFn = globalThis.fetch
}) {
  cleanupOldBinaries();
  say(`Checking for updates (current version: v${currentVersion})...`);

  let res;
  try {
    res = await checkUpdate({ currentVersion, force, fetchFn });
  } catch (err) {
    say(`FAIL  Could not check for updates: ${err.message}`);
    return 1;
  }

  if (!res.updateAvailable) {
    say(`ok    ORBIT is up to date (v${currentVersion}).`);
    return 0;
  }

  say(`\nUpdate available: v${currentVersion} -> v${res.latestVersion}`);
  say(`Release URL: ${res.releaseUrl}`);
  if (res.releaseNotes) {
    say('\nRelease notes:');
    say(res.releaseNotes.trim().split('\n').map(l => '  ' + l).join('\n'));
  }

  if (checkOnly) {
    return 2; // exit code 2 indicates update is available
  }

  const mode = getExecutionMode();

  if (mode === 'binary') {
    const isWin = process.platform === 'win32';
    const targetAsset = isWin ? 'orbit.exe' : 'orbit';
    const asset = res.assets.find(a => a.name.toLowerCase() === targetAsset.toLowerCase());
    const installerAsset = isWin ? res.assets.find(a => /setup.*\.exe$/i.test(a.name)) : null;

    if (!asset && !installerAsset) {
      say(`\nNo prebuilt binary asset is attached to GitHub release v${res.latestVersion} yet.`);
      say(`Visit ${res.releaseUrl} or run git pull to upgrade.`);
      return 0;
    }

    if (!yes) {
      const confirm = await ask('Proceed with update? [Y/n] ');
      if (confirm && !/^y/i.test(confirm.trim())) {
        say('Update cancelled.');
        return 0;
      }
    }

    const selectedAsset = asset || installerAsset;
    const { validateReleaseAsset, validateManifestEntry } = require('./update-security');
    const manifestAsset = res.assets.find(a => a.name === 'release-manifest.json');
    const tempFile = process.execPath + '.download';

    try {
      validateReleaseAsset(selectedAsset, selectedAsset.name, res.tag);
      if (!manifestAsset) throw new Error('Trusted release-manifest.json is missing; refusing an unverified update.');
      validateReleaseAsset(manifestAsset, 'release-manifest.json', res.tag);
      const manifestResponse = await fetchFn(manifestAsset.downloadUrl, { headers: { 'User-Agent': 'orbit-cli' } });
      if (!manifestResponse.ok) throw new Error(`Could not fetch release manifest: HTTP ${manifestResponse.status}.`);
      if (manifestResponse.url) require('./update-security').assertHttpsUrl(manifestResponse.url, 'manifest download URL');
      const manifest = await manifestResponse.json();
      const manifestEntry = validateManifestEntry(manifest, {
        tag: res.tag,
        assetName: selectedAsset.name,
        assetSize: selectedAsset.size
      });
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
      say(`Downloading and verifying ${selectedAsset.name}...`);
      await downloadBinary(selectedAsset.downloadUrl, tempFile, { asset: selectedAsset, manifestEntry, fetchFn });
      if (asset) {
        const replacement = replaceBinary(tempFile, process.execPath, res.latestVersion);
        if (process.platform === 'win32' && replacement?.scheduled) {
          say(`\nUpdate verified and staged for v${res.latestVersion}.`);
          say('ORBIT will replace its executable after this command exits. Open a new terminal and run orbit --version to confirm.');
          say('If replacement fails, the previous executable is restored; see %LOCALAPPDATA%\\ORBIT\\update-status.log for details.');
        } else {
          say(`\nSuccessfully upgraded ORBIT to v${res.latestVersion}!`);
          say(`Executable: ${process.execPath}`);
          say("Run 'orbit doctor' or 'orbit' to verify.");
        }
      } else {
        say(`\nVerified installer downloaded: ${tempFile}`);
        say('Run this installer manually to complete the upgrade. The current installation has not been changed.');
      }
      return 0;
    } catch (e) {
      if (fs.existsSync(tempFile)) {
        try { fs.unlinkSync(tempFile); } catch {}
      }
      say(`FAIL  Update failed: ${e.message}`);
      return 1;
    }
  }

  if (mode === 'git') {
    const root = path.resolve(__dirname, '..', '..');
    say(`\nORBIT is running from a git checkout at: ${root}`);
    if (!yes) {
      const confirm = await ask(`Fetch tags and update to v${res.latestVersion}? [Y/n] `);
      if (confirm && !/^y/i.test(confirm.trim())) {
        say('Update cancelled.');
        return 0;
      }
    }
    say('Fetching latest tags from origin...');
    const f = spawnSync('git', ['fetch', '--tags', 'origin'], { cwd: root, encoding: 'utf8' });
    if (f.status !== 0) {
      say(`FAIL  git fetch failed: ${f.stderr || f.stdout}`);
      return 1;
    }
    const c = spawnSync('git', ['checkout', `v${res.latestVersion}`], { cwd: root, encoding: 'utf8' });
    if (c.status !== 0) {
      say(`Note: could not checkout tag v${res.latestVersion}, trying git pull...`);
      const p = spawnSync('git', ['pull'], { cwd: root, encoding: 'utf8' });
      if (p.status !== 0) {
        say(`FAIL  git pull failed: ${p.stderr || p.stdout}`);
        return 1;
      }
    }
    say(`\nSuccessfully updated git repository to v${res.latestVersion}!`);
    say('If you have built dist/orbit.exe, rebuild it with: npm run build:exe');
    return 0;
  }

  // npm mode
  say('\nTo update your npm global installation, run:');
  say('  npm install -g orbit-runner@latest');
  return 0;
}

module.exports = {
  parseSemver,
  compareSemver,
  isNewer,
  checkUpdate,
  fetchLatestReleaseInfo,
  getExecutionMode,
  cleanupOldBinaries,
  getUpdateNotice,
  triggerBackgroundCheck,
  runUpdateCommand,
  getCachePath,
  readCache,
  writeCache
};
