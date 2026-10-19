const { command } = require('./discovery');

const GITHUB_API_ENDPOINT = 'https://api.github.com';

async function getCliAuthToken(ghExecutable = 'gh.exe') {
  const res = await command(ghExecutable, ['auth', 'token']);
  if (!res.ok || !res.output) {
    throw new Error('GitHub CLI is not authenticated. Run "gh auth login" in terminal or provide a GitHub token.');
  }
  return res.output.trim();
}

async function verifyGithubAuth({ token, ghExecutable }) {
  let authToken = (token || '').trim();
  let authSource = 'token';

  if (!authToken && ghExecutable) {
    authToken = await getCliAuthToken(ghExecutable);
    authSource = 'cli';
  }

  if (!authToken) {
    throw new Error('No GitHub authentication token or authenticated GitHub CLI found.');
  }

  const res = await fetch(`${GITHUB_API_ENDPOINT}/user`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${authToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'ORBIT-Windows-Worker'
    }
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || `GitHub API returned HTTP ${res.status}`);
  }

  const scopesHeader = res.headers.get('x-oauth-scopes') || '';
  const scopes = scopesHeader.split(',').map(s => s.trim()).filter(Boolean);

  return {
    login: data.login,
    name: data.name || data.login,
    avatarUrl: data.avatar_url || null,
    htmlUrl: data.html_url,
    scopes,
    authSource,
    token: authToken
  };
}

async function fetchGithubRepositories({ token, ghExecutable, perPage = 30 }) {
  let authToken = (token || '').trim();
  if (!authToken && ghExecutable) {
    authToken = await getCliAuthToken(ghExecutable);
  }

  if (!authToken) {
    throw new Error('GitHub token or authenticated CLI required.');
  }

  const res = await fetch(`${GITHUB_API_ENDPOINT}/user/repos?per_page=${perPage}&sort=updated`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${authToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'ORBIT-Windows-Worker'
    }
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || `GitHub API returned HTTP ${res.status}`);
  }

  if (!Array.isArray(data)) return [];

  return data.map(repo => ({
    id: repo.id,
    name: repo.name,
    fullName: repo.full_name,
    private: Boolean(repo.private),
    htmlUrl: repo.html_url,
    defaultBranch: repo.default_branch || 'main',
    permissions: repo.permissions || { admin: false, push: false, pull: true }
  }));
}

module.exports = {
  GITHUB_API_ENDPOINT,
  getCliAuthToken,
  verifyGithubAuth,
  fetchGithubRepositories
};
