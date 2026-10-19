const fs = require('node:fs');
const path = require('node:path');
class Store {
  constructor(app, safeStorage) {
    this.file = path.join(app.getPath('userData'), 'orbit-state.json');
    this.safeStorage = safeStorage;
    this.data = { settings: {}, projects: [], runtime: { paused: false, lastPollAt: null, activeTask: null }, history: [], pending: [] };
    this.load();
  }
  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data = { ...this.data, ...parsed, settings: { ...this.data.settings, ...(parsed.settings || {}) }, runtime: { ...this.data.runtime, ...(parsed.runtime || {}) }, pending: parsed.pending || [] };
    } catch {}
  }
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
  // Secrets are only ever protected by Electron safeStorage (Windows DPAPI tied
  // to the signed-in user), not by the 0o600 file mode above -- NTFS does not
  // honor POSIX mode bits, so that mode is best-effort only, not real ACL enforcement.
  getPublic() {
    const settings = {};
    for (const [k, v] of Object.entries(this.data.settings)) { if (!k.endsWith('Encrypted')) settings[k] = v; }
    settings.hasLinearApiKey = Boolean(this.data.settings.linearTokenEncrypted);
    settings.hasLinearOAuth = Boolean(this.data.settings.linearAccessTokenEncrypted);
    settings.hasLinearClientSecret = Boolean(this.data.settings.linearOAuthClientSecretEncrypted);
    settings.hasLinearConnected = settings.hasLinearOAuth || settings.hasLinearApiKey;
    settings.hasNotionConnected = Boolean(this.data.settings.notionTokenEncrypted);
    settings.hasObsidianConnected = Boolean(this.data.settings.obsidianConnected && this.data.settings.obsidianVaultPath);
    settings.hasGithubConnected = Boolean(this.data.settings.githubTokenEncrypted || this.data.settings.githubConnected);
    return { ...this.data, settings };
  }
  setSettings(settings) { this.data.settings = { ...this.data.settings, ...settings }; this.save(); }
  setSecret(key, value) {
    if (!value) { delete this.data.settings[`${key}Encrypted`]; this.save(); return; }
    if (!this.safeStorage.isEncryptionAvailable()) throw new Error('Windows secure credential encryption is unavailable.');
    this.data.settings[`${key}Encrypted`] = this.safeStorage.encryptString(value).toString('base64');
    this.save();
  }
  getSecret(key) {
    const raw = this.data.settings[`${key}Encrypted`];
    if (!raw) return '';
    if (!this.safeStorage.isEncryptionAvailable()) throw new Error('Windows secure credential encryption is unavailable.');
    return this.safeStorage.decryptString(Buffer.from(raw, 'base64'));
  }
  clearLinearAuth() {
    this.setSecret('linearToken', '');
    this.setSecret('linearAccessToken', '');
    this.setSecret('linearRefreshToken', '');
    this.setSecret('linearOAuthClientSecret', '');
    this.setSettings({
      linearTokenExpiresAt: null,
      linearWorkspaceName: '',
      linearWorkspaceKey: '',
      linearUserName: '',
      linearUserEmail: '',
      linearTeamKey: '',
      linearTeamName: '',
      linearProjectId: '',
      linearProjectName: '',
      linearTeams: [],
      inProgressStateId: '',
      reviewStateId: ''
    });
  }
  clearNotionAuth() {
    this.setSecret('notionToken', '');
    this.setSettings({
      notionConnected: false,
      notionWorkspaceName: '',
      notionBotName: '',
      notionSelectedDatabaseId: '',
      notionSelectedDatabaseTitle: '',
      notionSelectedPageId: '',
      notionSelectedPageTitle: '',
      notionLastCheckedAt: null
    });
  }
  clearObsidianAuth() {
    this.setSettings({
      obsidianConnected: false,
      obsidianVaultPath: '',
      obsidianVaultName: '',
      obsidianReadOnly: false,
      obsidianLastCheckedAt: null
    });
  }
  clearGithubAuth() {
    this.setSecret('githubToken', '');
    this.setSettings({
      githubConnected: false,
      githubLogin: '',
      githubName: '',
      githubSelectedRepo: '',
      githubRepoUrl: '',
      githubPermissions: null,
      githubLastCheckedAt: null
    });
  }
  updateRuntime(patch) { this.data.runtime = { ...this.data.runtime, ...patch }; this.save(); }
  addHistory(entry) { this.data.history.unshift({ at: new Date().toISOString(), ...entry }); this.data.history = this.data.history.slice(0, 100); this.save(); }
  addPending(entry) { if (!this.data.pending.some(p => p.issueId === entry.issueId)) { this.data.pending.unshift(entry); this.save(); } }
  removePending(issueId) { this.data.pending = this.data.pending.filter(p => p.issueId !== issueId); this.save(); }
}
module.exports = { Store };
