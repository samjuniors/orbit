const { app, BrowserWindow, Tray, Menu, nativeImage, Notification, ipcMain, safeStorage, shell, dialog } = require('electron');
const path = require('node:path');
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
    width: 1080,
    height: 820,
    minWidth: 860,
    minHeight: 680,
    show: false,
    title: 'ORBIT Worker',
    backgroundColor: '#0b1020',
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
  tray.setToolTip('ORBIT Worker');
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
