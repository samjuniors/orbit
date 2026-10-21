const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function getGitHubToken() {
  const envToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (envToken) return envToken.trim();
  const res = spawnSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n',
    encoding: 'utf8'
  });
  if (res.status === 0 && res.stdout) {
    const pwLine = res.stdout.split('\n').find(l => l.startsWith('password='));
    if (pwLine) return pwLine.slice(9).trim();
  }
  throw new Error('Could not find GitHub token in environment or Git Credential Manager');
}

function requestJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: {
        'User-Agent': 'orbit-release-publisher',
        'Accept': 'application/vnd.github+json',
        ...(options.headers || {})
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(data ? JSON.parse(data) : {});
          } catch {
            resolve(data);
          }
        } else {
          reject(new Error(`GitHub API error HTTP ${res.statusCode}: ${data}`));
        }
      });
    });
    req.on('error', reject);
    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

function uploadAsset(uploadUrlTemplate, filePath, fileName, token) {
  return new Promise((resolve, reject) => {
    const stats = fs.statSync(filePath);
    const cleanUrl = uploadUrlTemplate.replace(/\{(\?.*)?\}/, '') + `?name=${encodeURIComponent(fileName)}`;
    const parsed = new URL(cleanUrl);

    console.log(`Uploading ${fileName} (${(stats.size / 1024 / 1024).toFixed(1)} MB)…`);

    const req = https.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'User-Agent': 'orbit-release-publisher',
        'Authorization': `token ${token}`,
        'Content-Type': 'application/octet-stream',
        'Content-Length': stats.size
      }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log(`✔ Finished ${fileName}`);
          try { resolve(JSON.parse(data)); } catch { resolve(data); }
        } else {
          reject(new Error(`Upload failed HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);

    const stream = fs.createReadStream(filePath);
    stream.pipe(req);
  });
}

async function main() {
  const token = getGitHubToken();
  const repo = 'samjuniors/orbit';
  const tag = 'v0.7.0';

  console.log(`Connecting to GitHub (${repo})…`);

  // 1. Check existing release for tag
  let release = null;
  try {
    release = await requestJson(`https://api.github.com/repos/${repo}/releases/tags/${tag}`, {
      headers: { 'Authorization': `token ${token}` }
    });
    console.log(`Found release: ${release.name} (ID: ${release.id})`);
  } catch (err) {
    console.error('Could not find release for tag', tag, err.message);
    process.exit(1);
  }

  // Files to ensure are present in release
  const filesToUpload = [
    { path: path.resolve(__dirname, '../dist/Orbit-Desktop-Setup-0.7.0.exe'), name: 'Orbit-Desktop-Setup-0.7.0.exe' },
    { path: path.resolve(__dirname, '../dist/Orbit-Setup-0.7.0.exe'), name: 'Orbit-Setup-0.7.0.exe' },
    { path: path.resolve(__dirname, '../dist/orbit.exe'), name: 'orbit.exe' }
  ];

  // Refresh release data to get current assets
  const currentRelease = await requestJson(`https://api.github.com/repos/${repo}/releases/${release.id}`, {
    headers: { 'Authorization': `token ${token}` }
  });
  const existingAssetNames = new Set((currentRelease.assets || []).map(a => a.name));

  for (const file of filesToUpload) {
    if (existingAssetNames.has(file.name)) {
      console.log(`✔ Asset already present: ${file.name} (skipping upload)`);
      continue;
    }
    if (!fs.existsSync(file.path)) {
      console.warn(`File not found: ${file.path}, skipping.`);
      continue;
    }
    await uploadAsset(currentRelease.upload_url, file.path, file.name, token);
  }

  // Final summary
  const finalRelease = await requestJson(`https://api.github.com/repos/${repo}/releases/${release.id}`, {
    headers: { 'Authorization': `token ${token}` }
  });

  console.log(`\n🎉 Release published with ${finalRelease.assets.length} packages:`);
  finalRelease.assets.forEach(a => {
    console.log(` - ${a.name} (${(a.size / 1024 / 1024).toFixed(1)} MB) -> ${a.browser_download_url}`);
  });
  console.log(`\nOfficial Release URL: ${finalRelease.html_url}`);
}

main().catch(err => {
  console.error('\n❌ Release publish failed:', err.message);
  process.exit(1);
});
