const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);

async function command(commandName, args = []) {
  try {
    const isBatch = /\.(cmd|bat)$/i.test(commandName);
    const executable = isBatch ? 'powershell.exe' : commandName;
    const executableArgs = isBatch
      ? ['-NoProfile', '-NonInteractive', '-Command', '$a = ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:ORBIT_ARGS_B64))); & $env:ORBIT_EXE @a']
      : args;
    const env = { ...process.env };
    if (isBatch) { env.ORBIT_EXE = commandName; env.ORBIT_ARGS_B64 = Buffer.from(JSON.stringify(args), 'utf8').toString('base64'); }
    const { stdout, stderr } = await execFileAsync(executable, executableArgs, { windowsHide: true, timeout: 8000, maxBuffer: 1024 * 1024, env });
    return { ok: true, output: `${stdout || ''}${stderr || ''}`.trim() };
  } catch (error) { return { ok: false, output: (error.stderr || error.message || '').toString().trim() }; }
}
async function findWindowsCommand(names) {
  for (const name of names) {
    const r = await command('where.exe', [name]);
    if (r.ok && r.output) return { name, path: r.output.split(/\r?\n/)[0].trim() };
  }
  return null;
}
async function probe(label, candidates, versionArgs = ['--version']) {
  const found = await findWindowsCommand(candidates);
  if (!found) return { label, installed: false, candidates };
  const version = await command(found.path, versionArgs);
  return { label, installed: true, executable: found.path, version: version.ok ? version.output.split(/\r?\n/)[0].slice(0, 180) : 'Found; version check failed', launchable: version.ok };
}
function findGitRepos(roots, maxDepth = 3, maxResults = 60) {
  const found = [];
  const ignored = new Set(['node_modules', '.next', '.turbo', 'AppData', 'Windows', 'Program Files', 'Program Files (x86)', '$Recycle.Bin']);
  function walk(dir, depth) {
    if (found.length >= maxResults || depth > maxDepth) return;
    let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    if (entries.some(e => e.name === '.git' && (e.isDirectory() || e.isFile()))) { found.push({ name: path.basename(dir), path: dir }); return; }
    if (depth === maxDepth) return;
    for (const entry of entries) { if (!entry.isDirectory() || ignored.has(entry.name) || entry.name.startsWith('.')) continue; walk(path.join(dir, entry.name), depth + 1); if (found.length >= maxResults) break; }
  }
  for (const root of roots) walk(root, 0);
  return found;
}
function findObsidianVaults(configPath) {
  const filePath = configPath || (process.env.APPDATA ? path.join(process.env.APPDATA, 'obsidian', 'obsidian.json') : null);
  if (!filePath) return { installed: false, vaults: [] };
  try {
    if (!fs.existsSync(filePath)) return { installed: false, vaults: [] };
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!data || typeof data.vaults !== 'object' || !data.vaults) return { installed: true, vaults: [] };
    const vaults = Object.values(data.vaults)
      .filter(v => v && typeof v.path === 'string' && fs.existsSync(v.path))
      .map(v => ({ path: v.path, name: path.basename(v.path) }));
    return { installed: true, vaults };
  } catch {
    return { installed: false, vaults: [] };
  }
}

async function discoverMachine() {
  if (process.platform !== 'win32') throw new Error('The packaged ORBIT Worker currently supports Windows 10/11 x64 only.');
  const [node, npm, git, bash, agy, opencode, gh] = await Promise.all([
    probe('Node.js', ['node']), probe('npm', ['npm.cmd', 'npm']), probe('Git', ['git']), probe('Git Bash', ['bash.exe', 'bash']),
    probe('Antigravity CLI', ['agy.exe', 'agy', 'antigravity.exe', 'antigravity']), probe('OpenCode CLI', ['opencode.exe', 'opencode']),
    probe('GitHub CLI', ['gh.exe', 'gh'])
  ]);

  node.category = 'required';
  git.category = 'required';
  agy.category = 'agent';
  opencode.category = 'agent';
  npm.category = 'optional';
  bash.category = 'optional';
  gh.category = 'optional';

  if (agy.installed && agy.launchable) {
    const help = await command(agy.executable, ['--help']);
    agy.headlessReady = help.ok && /--prompt|--print|\s-p\b/.test(help.output) && /output-format/.test(help.output);
    agy.capabilityMessage = agy.headlessReady ? 'Headless prompt mode verified' : 'Found, but required headless flags were not verified';
  }
  if (opencode.installed && opencode.launchable) {
    const help = await command(opencode.executable, ['run', '--help']);
    opencode.headlessReady = help.ok && /--dir/.test(help.output) && /--format/.test(help.output);
    opencode.capabilityMessage = opencode.headlessReady ? 'Headless run mode verified' : 'Found, but required headless flags were not verified';
  }
  if (gh.installed && gh.launchable) {
    const authStatus = await command(gh.executable, ['auth', 'status']);
    gh.authenticated = authStatus.ok && !/not logged into/i.test(authStatus.output);
    gh.capabilityMessage = gh.authenticated ? 'Authenticated with GitHub' : 'Installed, but not authenticated';
  }
  const gitBashCandidates = [path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'bin', 'bash.exe'), path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'usr', 'bin', 'bash.exe')];
  for (const candidate of gitBashCandidates) if (!bash.installed && fs.existsSync(candidate)) { bash.installed = true; bash.executable = candidate; bash.launchable = true; break; }
  const roots = [path.join(os.homedir(), 'source'), path.join(os.homedir(), 'projects'), path.join(os.homedir(), 'Projects'), path.join(os.homedir(), 'code'), path.join(os.homedir(), 'dev'), path.join(os.homedir(), 'Documents', 'GitHub')];
  const existingRoots = roots.filter(p => fs.existsSync(p));

  const obsidianInfo = findObsidianVaults();
  const obsidian = {
    label: 'Obsidian',
    category: 'optional',
    installed: obsidianInfo.installed,
    vaults: obsidianInfo.vaults,
    capabilityMessage: obsidianInfo.vaults.length ? `Discovered ${obsidianInfo.vaults.length} local vault(s)` : 'No local vaults found'
  };

  const notion = {
    label: 'Notion',
    category: 'optional',
    installed: false,
    connected: false,
    capabilityMessage: 'Not connected (provider pending)'
  };

  // gh, obsidian, notion are optional: never required by validate().
  return {
    platform: process.platform,
    osRelease: os.release(),
    architecture: process.arch,
    home: os.homedir(),
    localAppData: process.env.LOCALAPPDATA || '',
    tools: { node, npm, git, bash, antigravity: agy, opencode, gh, obsidian, notion },
    projectSearchRoots: existingRoots,
    projectCandidates: findGitRepos(existingRoots),
    checkedAt: new Date().toISOString()
  };
}

module.exports = {
  command,
  findWindowsCommand,
  probe,
  findGitRepos,
  findObsidianVaults,
  discoverMachine
};