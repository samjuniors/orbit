const { app, BrowserWindow, Tray, Menu, nativeImage, Notification, ipcMain, safeStorage, shell, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { parsePlan } = require('./engine/plan');
const { loadPolicy, normalizePolicy, ADAPTER_IDS } = require('./engine/policy');
const { detect, listAdapters } = require('./engine/adapters');
const { runAdapterTest } = require('./engine/adapter-test');
const { paths, loadState } = require('./engine/state');
const { addTask } = require('./engine/ops');
const { runPlan, previewNext } = require('./engine/engine');
const { killAll } = require('./engine/process');
const { checkUpdate } = require('./engine/update');
const { nextStep } = require('./engine/next');
const { suggestVerify } = require('./engine/setup');
const { Store } = require('./core/store');
const { discoverMachine } = require('./core/discovery');
const { inspectTeam, fetchWorkspaceContext } = require('./core/linear');
const { getLinearAuthHeader } = require('./core/linear-auth');
const { authorize, exchangeCodeForToken, REDIRECT_URI, DEFAULT_CLIENT_ID } = require('./core/oauth');
const { verifyNotionToken, searchNotionResources } = require('./core/notion');
const { listDiscoveredVaults, validateVault } = require('./core/obsidian');
const { verifyGithubAuth, fetchGithubRepositories } = require('./core/github');
const { OrbitWorker } = require('./core/worker');
const { shouldHideWindowOnClose, handleSecondInstance, buildTrayMenuTemplate, canAutoStartWorker } = require('./core/lifecycle');

if (process.platform !== 'win32') app.quit();

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
} else {
  app.on('second-instance', () => {
    handleSecondInstance({ mainWindow });
  });
}

app.setAppUserModelId('com.samjuniors.orbit.worker');
let mainWindow, tray, store, worker, discoveryCache, currentAuthAttempt;
const iconPngDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAk0lEQVR4nO3TwQ2AMAwDwC7LDozMFjAASuI4TvtoLfVH4pNKxzgxct3PqzzLilOQ7vIQEQ2ioQCqchqhKkYhEEAVKYC5KgrAlGdmXUClHN2RArDvvRVQ/aYEsHIA+wCW/4TTnyGDiHa4gCoCmQ0BLAKdoQFMaIACYe2FASwk2vcDKBFUOQJQHRMwA+GWd0Lg4u3yAchpZuh8zEMCAAAAAElFTkSuQmCC';
function makeIcon() { return nativeImage.createFromDataURL(iconPngDataUrl); }
function notify(title, body, hideWindow = false) { if (Notification.isSupported()) new Notification({ title, body, icon: makeIcon() }).show(); if (hideWindow) mainWindow?.hide(); }
function emit(event) {
  mainWindow?.webContents.send('orbit:event', event);
  if (event?.type === 'worker' || event?.type === 'schedule') updateTrayMenu();
}

function showWindow(targetView) {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    if (targetView) mainWindow.webContents.send('orbit:navigate', targetView);
  }
}

function updateTrayMenu() {
  if (!tray) return;
  const isPaused = Boolean(store?.data?.runtime?.paused);
  const template = buildTrayMenuTemplate({
    isPaused,
    onOpen: () => showWindow(),
    onTogglePause: (paused) => {
      worker?.pause(paused);
      updateTrayMenu();
    },
    onSettings: () => showWindow('settings'),
    onQuit: () => {
      app.isQuitting = true;
      worker?.stopScheduler();
      worker?.stop();
      app.quit();
    }
  });
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 840,
    minWidth: 900,
    minHeight: 680,
    show: false,
    title: 'ORBIT Desktop v0.7.0',
    backgroundColor: '#070a13',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => {
    if (process.argv.includes('--hidden')) mainWindow.hide();
    else mainWindow.show();
  });
  mainWindow.on('close', event => {
    if (shouldHideWindowOnClose({ isQuitting: app.isQuitting })) {
      event.preventDefault();
      mainWindow.hide();
      if (!store.data.settings.trayNoticeShown) {
        store.setSettings({ trayNoticeShown: true });
        notify('ORBIT is still running', 'ORBIT continues running in your system tray. Click the tray icon to open it at any time.');
      }
    }
  });
}

function createTray() {
  tray = new Tray(makeIcon());
  tray.setToolTip('ORBIT Desktop v0.7.0');
  updateTrayMenu();
  tray.on('click', () => showWindow());
  tray.on('double-click', () => showWindow());
}

app.whenReady().then(async () => {
  store = new Store(app, safeStorage);
  worker = new OrbitWorker({ store, notify: (title, body) => notify(title, body, true), emit, getDiscovery: () => discoveryCache });
  worker.recoverInterrupted();

  // Register all IPC handlers immediately before createWindow/discovery so renderer calls never hit missing handler
  ipcMain.handle('orbit:get-state', () => ({ state: store.getPublic(), discovery: discoveryCache, redirectUri: REDIRECT_URI }));
  ipcMain.handle('orbit:discover', async () => { discoveryCache = await discoverMachine(); return discoveryCache; });
  ipcMain.handle('orbit:browse-project', async () => { const result = await dialog.showOpenDialog(mainWindow, { title: 'Select a Git project folder', properties: ['openDirectory'] }); return result.canceled ? null : result.filePaths[0]; });
  ipcMain.handle('orbit:save-settings', async (_e, payload) => {
    const { linearToken, linearOAuthClientSecret, ...settings } = payload;
    if (linearToken !== undefined) store.setSecret('linearToken', linearToken);
    if (linearOAuthClientSecret !== undefined) store.setSecret('linearOAuthClientSecret', linearOAuthClientSecret);
    store.setSettings(settings);
    return store.getPublic();
  });
  ipcMain.handle('orbit:complete-onboarding', async (_e, payload) => {
    const { linearToken, linearOAuthClientSecret, startWorker = true, ...settings } = payload || {};
    if (linearToken !== undefined) store.setSecret('linearToken', linearToken);
    if (linearOAuthClientSecret !== undefined) store.setSecret('linearOAuthClientSecret', linearOAuthClientSecret);
    store.setSettings({ ...settings, onboardingComplete: true });
    if (startWorker) {
      await worker.validate();
      store.setSettings({ autoRunEnabled: true });
      worker.start();
    }
    return store.getPublic();
  });
  ipcMain.handle('orbit:hide-window', () => {
    if (mainWindow) mainWindow.hide();
    return true;
  });
  ipcMain.handle('orbit:test-linear', async (_e, payload) => inspectTeam(await getLinearAuthHeader(store), payload.teamKey));
  ipcMain.handle('orbit:oauth-connect', async (_e, payload = {}) => {
    const rawClientId = (payload.clientId || '').trim() || store.data.settings.linearOAuthClientId || (process.env.LINEAR_CLIENT_ID || '').trim();
    if (!rawClientId || rawClientId === 'orbit-desktop-worker') {
      throw new Error('Linear OAuth requires a registered Client ID from your Linear workspace (Settings > API > Applications). To connect in 1 click without OAuth setup, use your Personal API Key (lin_api_...).');
    }
    const clientId = rawClientId;
    const clientSecret = (payload.clientSecret || '').trim() || store.getSecret('linearOAuthClientSecret');

    if (currentAuthAttempt) {
      try { currentAuthAttempt.cancel(); } catch {}
      currentAuthAttempt = null;
    }

    if (payload.clientSecret !== undefined) {
      store.setSecret('linearOAuthClientSecret', payload.clientSecret ? payload.clientSecret.trim() : '');
    }
    store.setSettings({ linearOAuthClientId: clientId, linearAuthMode: 'oauth' });

    const auth = await authorize({ clientId });
    currentAuthAttempt = auth;

    await shell.openExternal(auth.authUrl);

    let code;
    try {
      const result = await auth.waitForCode();
      code = result.code;
    } finally {
      if (currentAuthAttempt === auth) currentAuthAttempt = null;
    }

    const tokens = await exchangeCodeForToken({
      clientId,
      clientSecret: clientSecret || undefined,
      code,
      verifier: auth.verifier
    });

    store.setSecret('linearAccessToken', tokens.access_token);
    if (tokens.refresh_token) store.setSecret('linearRefreshToken', tokens.refresh_token);
    store.setSettings({
      linearTokenExpiresAt: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : null,
      linearAuthMode: 'oauth'
    });

    let workspaceContext = null;
    try {
      const authHeader = `Bearer ${tokens.access_token}`;
      workspaceContext = await fetchWorkspaceContext(authHeader);
      const firstTeam = workspaceContext.teams?.[0];
      const defaultTeamKey = store.data.settings.linearTeamKey || firstTeam?.key || '';
      const defaultTeam = workspaceContext.teams?.find(t => t.key === defaultTeamKey) || firstTeam;
      const defaultProjectId = store.data.settings.linearProjectId || defaultTeam?.projects?.[0]?.id || '';
      const defaultProject = defaultTeam?.projects?.find(p => p.id === defaultProjectId);
      const inProgressState = defaultTeam?.states?.find(s => s.type === 'started') || defaultTeam?.states?.find(s => /progress/i.test(s.name));
      const reviewState = defaultTeam?.states?.find(s => /review/i.test(s.name));

      store.setSettings({
        linearWorkspaceName: workspaceContext.organization.name,
        linearWorkspaceKey: workspaceContext.organization.urlKey,
        linearUserName: workspaceContext.viewer.name,
        linearUserEmail: workspaceContext.viewer.email,
        linearTeams: workspaceContext.teams,
        linearTeamKey: defaultTeamKey,
        linearTeamName: defaultTeam?.name || '',
        linearProjectId: defaultProjectId,
        linearProjectName: defaultProject?.name || '',
        inProgressStateId: store.data.settings.inProgressStateId || inProgressState?.id || '',
        reviewStateId: store.data.settings.reviewStateId || reviewState?.id || ''
      });
    } catch (e) {
      console.warn('Could not auto-fetch Linear workspace context:', e.message);
    }

    return { ...store.getPublic(), workspaceContext };
  });
  ipcMain.handle('orbit:oauth-cancel', () => {
    if (currentAuthAttempt) {
      try { currentAuthAttempt.cancel(); } catch {}
      currentAuthAttempt = null;
    }
    return true;
  });
  ipcMain.handle('orbit:fetch-linear-context', async () => {
    const authHeader = await getLinearAuthHeader(store);
    const workspaceContext = await fetchWorkspaceContext(authHeader);
    const firstTeam = workspaceContext.teams?.[0];
    const defaultTeamKey = store.data.settings.linearTeamKey || firstTeam?.key || '';
    const defaultTeam = workspaceContext.teams?.find(t => t.key === defaultTeamKey) || firstTeam;
    const defaultProjectId = store.data.settings.linearProjectId || defaultTeam?.projects?.[0]?.id || '';
    const defaultProject = defaultTeam?.projects?.find(p => p.id === defaultProjectId);
    const inProgressState = defaultTeam?.states?.find(s => s.type === 'started') || defaultTeam?.states?.find(s => /progress/i.test(s.name));
    const reviewState = defaultTeam?.states?.find(s => /review/i.test(s.name));

    store.setSettings({
      linearWorkspaceName: workspaceContext.organization.name,
      linearWorkspaceKey: workspaceContext.organization.urlKey,
      linearUserName: workspaceContext.viewer.name,
      linearUserEmail: workspaceContext.viewer.email,
      linearTeams: workspaceContext.teams,
      linearTeamKey: defaultTeamKey,
      linearTeamName: defaultTeam?.name || '',
      linearProjectId: defaultProjectId,
      linearProjectName: defaultProject?.name || '',
      inProgressStateId: store.data.settings.inProgressStateId || inProgressState?.id || '',
      reviewStateId: store.data.settings.reviewStateId || reviewState?.id || ''
    });
    return workspaceContext;
  });
  ipcMain.handle('orbit:oauth-disconnect', () => {
    if (currentAuthAttempt) {
      try { currentAuthAttempt.cancel(); } catch {}
      currentAuthAttempt = null;
    }
    store.clearLinearAuth();
    return store.getPublic();
  });
  ipcMain.handle('orbit:connect-linear-api-key', async (_e, payload = {}) => {
    const key = (payload.apiKey || '').trim();
    if (!key) throw new Error('Linear API key is required.');
    const workspaceContext = await fetchWorkspaceContext(key);
    store.setSecret('linearToken', key);
    const firstTeam = workspaceContext.teams?.[0];
    const defaultTeamKey = store.data.settings.linearTeamKey || firstTeam?.key || '';
    const defaultTeam = workspaceContext.teams?.find(t => t.key === defaultTeamKey) || firstTeam;
    const defaultProjectId = store.data.settings.linearProjectId || defaultTeam?.projects?.[0]?.id || '';
    const defaultProject = defaultTeam?.projects?.find(p => p.id === defaultProjectId);
    const inProgressState = defaultTeam?.states?.find(s => s.type === 'started') || defaultTeam?.states?.find(s => /progress/i.test(s.name));
    const reviewState = defaultTeam?.states?.find(s => /review/i.test(s.name));

    store.setSettings({
      linearAuthMode: 'apiKey',
      linearWorkspaceName: workspaceContext.organization.name,
      linearWorkspaceKey: workspaceContext.organization.urlKey,
      linearUserName: workspaceContext.viewer.name,
      linearUserEmail: workspaceContext.viewer.email,
      linearTeams: workspaceContext.teams,
      linearTeamKey: defaultTeamKey,
      linearTeamName: defaultTeam?.name || '',
      linearProjectId: defaultProjectId,
      linearProjectName: defaultProject?.name || '',
      inProgressStateId: store.data.settings.inProgressStateId || inProgressState?.id || '',
      reviewStateId: store.data.settings.reviewStateId || reviewState?.id || ''
    });
    return { ...store.getPublic(), workspaceContext };
  });

  // Notion handlers
  ipcMain.handle('orbit:notion-connect', async (_e, payload = {}) => {
    const token = (payload.token || '').trim();
    if (!token) throw new Error('Notion integration token is required.');
    const user = await verifyNotionToken(token);
    store.setSecret('notionToken', token);
    const resources = await searchNotionResources(token).catch(() => ({ results: [], databases: [], pages: [] }));
    store.setSettings({
      notionConnected: true,
      notionWorkspaceName: user.workspaceName,
      notionBotName: user.name,
      notionLastCheckedAt: new Date().toISOString()
    });
    return { ...store.getPublic(), user, resources };
  });
  ipcMain.handle('orbit:notion-disconnect', () => {
    store.clearNotionAuth();
    return store.getPublic();
  });
  ipcMain.handle('orbit:notion-fetch-resources', async () => {
    const token = store.getSecret('notionToken');
    if (!token) throw new Error('Notion is not connected.');
    return searchNotionResources(token);
  });
  ipcMain.handle('orbit:notion-save-selection', (_e, payload = {}) => {
    store.setSettings({
      notionSelectedDatabaseId: payload.databaseId || '',
      notionSelectedDatabaseTitle: payload.databaseTitle || '',
      notionSelectedPageId: payload.pageId || '',
      notionSelectedPageTitle: payload.pageTitle || ''
    });
    return store.getPublic();
  });

  // Obsidian handlers
  ipcMain.handle('orbit:obsidian-list-vaults', () => listDiscoveredVaults());
  ipcMain.handle('orbit:obsidian-connect', async (_e, payload = {}) => {
    const vaultPath = (payload.vaultPath || '').trim();
    const validated = validateVault(vaultPath);
    store.setSettings({
      obsidianConnected: true,
      obsidianVaultPath: validated.path,
      obsidianVaultName: validated.name,
      obsidianReadOnly: true,
      obsidianLastCheckedAt: new Date().toISOString()
    });
    return store.getPublic();
  });
  ipcMain.handle('orbit:obsidian-disconnect', () => {
    store.clearObsidianAuth();
    return store.getPublic();
  });

  // GitHub handlers
  ipcMain.handle('orbit:github-connect', async (_e, payload = {}) => {
    const ghExe = discoveryCache?.tools?.gh?.executable || 'gh.exe';
    const verified = await verifyGithubAuth({ token: payload.token, ghExecutable: ghExe });
    if (verified.token) {
      store.setSecret('githubToken', verified.token);
    }
    const repos = await fetchGithubRepositories({ token: verified.token, ghExecutable: ghExe }).catch(() => []);
    store.setSettings({
      githubConnected: true,
      githubLogin: verified.login,
      githubName: verified.name,
      githubScopes: verified.scopes,
      githubLastCheckedAt: new Date().toISOString()
    });
    return { ...store.getPublic(), user: verified, repos };
  });
  ipcMain.handle('orbit:github-disconnect', () => {
    store.clearGithubAuth();
    return store.getPublic();
  });
  ipcMain.handle('orbit:github-fetch-repos', async () => {
    const ghExe = discoveryCache?.tools?.gh?.executable || 'gh.exe';
    const token = store.getSecret('githubToken');
    return fetchGithubRepositories({ token, ghExecutable: ghExe });
  });
  ipcMain.handle('orbit:github-save-selection', (_e, payload = {}) => {
    store.setSettings({
      githubSelectedRepo: payload.selectedRepo || '',
      githubRepoUrl: payload.repoUrl || '',
      githubPermissions: payload.permissions || null
    });
    return store.getPublic();
  });
  ipcMain.handle('orbit:approve-task', async (_e, issueId) => { await worker.approve(issueId); return store.getPublic(); });
  ipcMain.handle('orbit:reject-task', async (_e, issueId) => { await worker.reject(issueId); return store.getPublic(); });
  ipcMain.handle('orbit:resume-task', async (_e, { issueId, note }) => { await worker.resume(issueId, note); return store.getPublic(); });
  ipcMain.handle('orbit:start', async () => { await worker.validate(); store.setSettings({ autoRunEnabled: true }); worker.start(); updateTrayMenu(); return true; });
  ipcMain.handle('orbit:stop', () => { worker.stop(); updateTrayMenu(); return true; });
  ipcMain.handle('orbit:pause', (_e, value) => { worker.pause(Boolean(value)); updateTrayMenu(); return true; });
  ipcMain.handle('orbit:set-startup', (_e, enabled) => { app.setLoginItemSettings({ openAtLogin: Boolean(enabled), path: app.getPath('exe'), args: ['--hidden'] }); store.setSettings({ startAtLogin: Boolean(enabled) }); return true; });
  ipcMain.handle('orbit:open-path', (_e, target) => shell.openPath(target));
  ipcMain.handle('orbit:open-url', (_e, target) => shell.openExternal(target));

  // --- ORBIT v0.7.0 Core Engine Handlers ---
  let activeProjectDir = store.data.settings.projectRoot || path.resolve(__dirname, '../../../');
  if (!fs.existsSync(activeProjectDir)) activeProjectDir = process.cwd();

  function getProjectInfo(dir = activeProjectDir) {
    const planPath = path.join(dir, 'PLAN.md');
    const polPath = path.join(dir, 'orbit.policy.json');
    const planExists = fs.existsSync(planPath);
    const policyExists = fs.existsSync(polPath);
    let plan = null;
    if (planExists) {
      try { plan = parsePlan(fs.readFileSync(planPath, 'utf8')); } catch {}
    }
    let policy = null;
    if (policyExists) {
      try { policy = loadPolicy(polPath); } catch {}
    }
    const state = loadState(dir);
    const p = paths(dir);
    let report = '';
    if (fs.existsSync(p.report)) {
      try { report = fs.readFileSync(p.report, 'utf8'); } catch {}
    }
    const adapters = listAdapters(policy || {});

    const gitCheck = spawnSync('git', ['--version'], { encoding: 'utf8' });
    const gitRepoCheck = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir });
    const doctor = {
      nodeOk: Number(process.versions.node.split('.')[0]) >= 20,
      nodeVersion: process.version,
      gitOk: gitCheck.status === 0,
      gitVersion: (gitCheck.stdout || '').trim(),
      isGitRepo: gitRepoCheck.status === 0,
      planOk: Boolean(plan && plan.tasks.length > 0),
      planTaskCount: plan?.tasks?.length || 0,
      policyOk: Boolean(policy && (policy.verify || policy.allowUnverified)),
      agentOk: Boolean(policy && detect(policy.agent, policy))
    };

    const gitBranchCheck = spawnSync('git', ['branch', '--show-current'], { cwd: dir, encoding: 'utf8' });
    const gitBranch = (gitBranchCheck.stdout || '').trim() || 'main';

    let nextAction = [];
    try {
      nextAction = nextStep({ root: dir });
    } catch (e) {
      nextAction = [`Inspection error: ${e.message}`];
    }

    const suggestedVerify = suggestVerify(dir) || 'npm test';

    return {
      dir,
      version: '0.7.0',
      gitBranch,
      planExists,
      policyExists,
      plan,
      policy: policy || {
        agent: 'claude-code',
        agentArgs: [],
        verify: suggestedVerify,
        approval: 'none',
        limits: { maxAttempts: 3, taskTimeoutMin: 30, stallMin: 10, maxTasks: 0, maxRuntimeMin: 0 },
        rules: { 'git.push': 'block', 'git.merge': 'block', 'pr.create': 'block' }
      },
      state,
      report,
      adapters,
      doctor,
      nextAction,
      suggestedVerify
    };
  }

  let activePlanRun = false;

  ipcMain.handle('orbit:get-project-info', () => getProjectInfo(activeProjectDir));

  ipcMain.handle('orbit:run-setup', async (_e, { agent, verify, approval, firstTask }) => {
    const polPath = path.join(activeProjectDir, 'orbit.policy.json');
    const planPath = path.join(activeProjectDir, 'PLAN.md');
    let existing = {};
    try { existing = loadPolicy(polPath); } catch {}
    const policy = {
      ...existing,
      agent: agent || 'claude-code',
      verify: verify || 'npm test',
      approval: approval || 'none',
      limits: { maxAttempts: 3, taskTimeoutMin: 30, stallMin: 10, maxTasks: 0, maxRuntimeMin: 0, ...(existing.limits || {}) },
      rules: { 'git.push': 'block', 'git.merge': 'block', 'pr.create': 'block', ...(existing.rules || {}) }
    };
    fs.writeFileSync(polPath, JSON.stringify(policy, null, 2) + '\n');
    if (!fs.existsSync(planPath) || firstTask) {
      const title = path.basename(activeProjectDir);
      const body = `# ${title}\n\nDescribe the project here: stack, conventions, what "good" looks like. Every task sees this.\n\n- [ ] ${firstTask || 'Scaffold first feature'}\n  Add concrete acceptance criteria so verification passes.\n`;
      fs.writeFileSync(planPath, body);
    }
    return getProjectInfo(activeProjectDir);
  });

  ipcMain.handle('orbit:select-project-dir', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      defaultPath: activeProjectDir
    });
    if (!res.canceled && res.filePaths[0]) {
      activeProjectDir = res.filePaths[0];
      store.setSettings({ projectRoot: activeProjectDir });
      return getProjectInfo(activeProjectDir);
    }
    return getProjectInfo(activeProjectDir);
  });

  ipcMain.handle('orbit:init-project', async () => {
    const planPath = path.join(activeProjectDir, 'PLAN.md');
    const polPath = path.join(activeProjectDir, 'orbit.policy.json');
    if (!fs.existsSync(planPath)) {
      fs.writeFileSync(planPath, `# My Project\n\nDescribe the project here: stack, conventions, what "good" looks like.\n\n- [ ] Scaffold the project\n  Set up the project structure and a passing test command.\n- [ ] Add the first feature\n  Describe it concretely, with acceptance criteria.\n`);
    }
    if (!fs.existsSync(polPath)) {
      fs.writeFileSync(polPath, JSON.stringify({
        agent: 'claude-code',
        agentArgs: [],
        verify: 'npm test',
        approval: 'none',
        limits: { maxAttempts: 3, taskTimeoutMin: 30, stallMin: 10, maxTasks: 0, maxRuntimeMin: 0 },
        rules: { 'git.push': 'block', 'git.merge': 'block', 'pr.create': 'block' }
      }, null, 2) + '\n');
    }
    return getProjectInfo(activeProjectDir);
  });

  ipcMain.handle('orbit:add-task', async (_e, { title, details }) => {
    addTask({ root: activeProjectDir, planFile: 'PLAN.md', title, details: details || '' });
    return getProjectInfo(activeProjectDir);
  });

  ipcMain.handle('orbit:save-policy', async (_e, newPolicy) => {
    const polPath = path.join(activeProjectDir, 'orbit.policy.json');
    fs.writeFileSync(polPath, JSON.stringify(newPolicy, null, 2) + '\n');
    return getProjectInfo(activeProjectDir);
  });

  ipcMain.handle('orbit:dry-run', async () => {
    const policy = loadPolicy(path.join(activeProjectDir, 'orbit.policy.json'));
    return previewNext({ root: activeProjectDir, planFile: 'PLAN.md', policy });
  });

  ipcMain.handle('orbit:run-plan', async () => {
    if (activePlanRun) throw new Error('A plan run is already in progress.');
    activePlanRun = true;
    const policy = loadPolicy(path.join(activeProjectDir, 'orbit.policy.json'));
    const io = {
      log: m => mainWindow?.webContents.send('orbit:plan-log', m),
      event: e => mainWindow?.webContents.send('orbit:plan-event', e),
      ask: async () => 'y',
      onOutput: e => mainWindow?.webContents.send('orbit:plan-output', e),
      sleep: ms => new Promise(r => setTimeout(r, ms)),
      now: () => Date.now()
    };
    runPlan({ root: activeProjectDir, planFile: 'PLAN.md', policy, io })
      .then(res => {
        activePlanRun = false;
        mainWindow?.webContents.send('orbit:plan-finished', res);
      })
      .catch(err => {
        activePlanRun = false;
        mainWindow?.webContents.send('orbit:plan-error', err.message);
      });
    return true;
  });

  ipcMain.handle('orbit:stop-plan', () => {
    killAll();
    activePlanRun = false;
    return true;
  });

  ipcMain.handle('orbit:approve-plan-task', (_e, { id }) => {
    const p = paths(activeProjectDir);
    fs.mkdirSync(p.approvals, { recursive: true });
    fs.writeFileSync(path.join(p.approvals, `${id}.approve`), '');
    return getProjectInfo(activeProjectDir);
  });

  ipcMain.handle('orbit:reject-plan-task', (_e, { id, reason }) => {
    const p = paths(activeProjectDir);
    fs.mkdirSync(p.approvals, { recursive: true });
    fs.writeFileSync(path.join(p.approvals, `${id}.reject`), reason || '');
    return getProjectInfo(activeProjectDir);
  });

  ipcMain.handle('orbit:test-adapter', async (_e, agentId) => {
    let pol = {};
    try { pol = loadPolicy(path.join(activeProjectDir, 'orbit.policy.json')); } catch {}
    const policy = normalizePolicy({ ...pol, agent: agentId });
    return runAdapterTest({ policy });
  });

  ipcMain.handle('orbit:check-updates', async () => {
    return checkUpdate({ currentVersion: '0.7.0', force: true });
  });

  createWindow();
  createTray();

  try {
    discoveryCache = await discoverMachine();
    emit({ type: 'discovery', result: discoveryCache });
  } catch (e) {
    discoveryCache = { error: e.message, tools: {} };
  }

  if (process.argv.includes('--hidden')) mainWindow.hide();

  worker.startScheduler();
  if (canAutoStartWorker({ settings: store.data.settings })) {
    try { await worker.validate(); worker.start(); } catch (e) { notify('ORBIT needs setup', e.message); }
  }
});
app.on('before-quit', () => { app.isQuitting = true; worker?.stopScheduler(); worker?.stop(); });
