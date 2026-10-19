const http = require('node:http');
const crypto = require('node:crypto');

const AUTHORIZE_URL = 'https://linear.app/oauth/authorize';
const TOKEN_URL = 'https://api.linear.app/oauth/token';

// Fixed on purpose: Linear (like most OAuth providers) requires an exact,
// pre-registered redirect URI. A random ephemeral port would need to be
// re-registered on every run, so ORBIT always asks for this one port and
// the user registers it once in their Linear OAuth application settings.
const LOOPBACK_PORT = 53791;
const REDIRECT_PATH = '/orbit/oauth/callback';
const REDIRECT_URI = `http://127.0.0.1:${LOOPBACK_PORT}${REDIRECT_PATH}`;
const DEFAULT_SCOPE = 'read,write';
const DEFAULT_CLIENT_ID = process.env.LINEAR_CLIENT_ID || '';

function randomState() { return crypto.randomBytes(16).toString('base64url'); }

const CODE_VERIFIER_REGEX = /^[A-Za-z0-9\-._~]{43,128}$/;

function isValidCodeVerifier(verifier) {
  return typeof verifier === 'string' && CODE_VERIFIER_REGEX.test(verifier);
}

function generateCodeVerifier() {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier) {
  if (!isValidCodeVerifier(verifier)) {
    throw new Error('A valid PKCE code_verifier is required to compute a code challenge (RFC 7636: 43-128 characters from [A-Z, a-z, 0-9, -, ., _, ~]).');
  }
  return crypto.createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length === 0 || bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function buildAuthorizationUrl({
  clientId,
  state,
  scope = DEFAULT_SCOPE,
  codeChallenge,
  code_challenge,
  codeVerifier,
  code_verifier,
  codeChallengeMethod,
  code_challenge_method
}) {
  if (codeChallenge !== undefined && code_challenge !== undefined && codeChallenge !== code_challenge) {
    throw new Error('Conflicting code challenge values supplied.');
  }
  if (codeVerifier !== undefined && code_verifier !== undefined && codeVerifier !== code_verifier) {
    throw new Error('Conflicting code verifier values supplied.');
  }
  if (codeChallengeMethod !== undefined && code_challenge_method !== undefined && codeChallengeMethod !== code_challenge_method) {
    throw new Error(`Conflicting code challenge methods supplied: "${codeChallengeMethod}" vs "${code_challenge_method}".`);
  }
  if (codeChallengeMethod !== undefined && codeChallengeMethod !== 'S256') {
    throw new Error(`Unsupported codeChallengeMethod: "${codeChallengeMethod}". Only S256 is supported.`);
  }
  if (code_challenge_method !== undefined && code_challenge_method !== 'S256') {
    throw new Error(`Unsupported code_challenge_method: "${code_challenge_method}". Only S256 is supported.`);
  }

  const u = new URL(AUTHORIZE_URL);
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('redirect_uri', REDIRECT_URI);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', scope);
  u.searchParams.set('state', state);
  u.searchParams.set('prompt', 'consent');
  const verifier = codeVerifier || code_verifier;
  const challenge = codeChallenge || code_challenge || (verifier ? generateCodeChallenge(verifier) : null);
  if (challenge) {
    u.searchParams.set('code_challenge', challenge);
    u.searchParams.set('code_challenge_method', 'S256');
  }
  return u.toString();
}

function openLoopbackServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.on('error', err => {
      if (err.code === 'EADDRINUSE') reject(new Error(`Port ${LOOPBACK_PORT} is already in use. Close whatever is using it (or a previous ORBIT auth attempt) and try connecting again.`));
      else reject(err);
    });
    server.listen(LOOPBACK_PORT, '127.0.0.1', () => resolve(server));
  });
}

function waitForCallback(server, expectedState, timeoutMs = 5 * 60 * 1000, options = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => finish(new Error('Timed out waiting for the Linear authorization redirect.')), timeoutMs);
    const finish = (err, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.removeAllListeners('request');
      server.close(() => {});
      err ? reject(err) : resolve(result);
    };

    if (options.signal) {
      if (options.signal.aborted) {
        finish(new Error('OAuth authorization was cancelled.'));
        return;
      }
      options.signal.addEventListener('abort', () => {
        finish(new Error('OAuth authorization was cancelled.'));
      });
    }

    server.on('request', (req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname !== REDIRECT_PATH) { res.writeHead(404).end(); return; }
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');

      const isStateValid = Boolean(state && safeCompare(state, expectedState));
      const isSuccess = isStateValid && !error && Boolean(code);

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><html><body style="font-family:sans-serif;padding:40px;background:#0b1020;color:#eef1fb"><h2>ORBIT Worker</h2><p>${isSuccess ? 'Linear connected. You can close this window and return to ORBIT Worker.' : 'Authorization failed. You can close this window and return to ORBIT.'}</p></body></html>`);

      if (!isStateValid) {
        return finish(new Error('OAuth state mismatch; the request may have been intercepted. Try connecting again.'));
      }
      if (error) {
        return finish(new Error(`Linear denied authorization: ${error}`));
      }
      if (!code) {
        return finish(new Error('Linear did not return an authorization code.'));
      }
      finish(null, { code });
    });
  });
}

async function authorize({ clientId, scope, signal } = {}) {
  if (!clientId || clientId === 'orbit-desktop-worker') {
    throw new Error('Enter a registered Linear OAuth Client ID (from Linear Settings > API > Applications), or connect using a Personal API Key.');
  }
  const state = randomState();
  const verifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(verifier);
  const server = await openLoopbackServer();
  const controller = new AbortController();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort());
  }
  const waiting = waitForCallback(server, state, 5 * 60 * 1000, { signal: controller.signal });
  const authUrl = buildAuthorizationUrl({
    clientId,
    state,
    scope,
    codeChallenge,
    codeChallengeMethod: 'S256'
  });
  return {
    authUrl,
    redirectUri: REDIRECT_URI,
    verifier,
    codeVerifier: verifier,
    state,
    cancel: () => controller.abort(),
    waitForCode: () => waiting
  };
}

async function exchangeCodeForToken({ clientId, clientSecret, code, verifier, codeVerifier, code_verifier }) {
  if (verifier !== undefined && codeVerifier !== undefined && verifier !== codeVerifier) {
    throw new Error('Conflicting code verifier values supplied.');
  }
  if (verifier !== undefined && code_verifier !== undefined && verifier !== code_verifier) {
    throw new Error('Conflicting code verifier values supplied.');
  }
  if (codeVerifier !== undefined && code_verifier !== undefined && codeVerifier !== code_verifier) {
    throw new Error('Conflicting code verifier values supplied.');
  }
  const verifierValue = verifier || codeVerifier || code_verifier;
  if (!isValidCodeVerifier(verifierValue)) {
    throw new Error('A valid PKCE code_verifier is required for token exchange (RFC 7636: 43-128 characters from [A-Z, a-z, 0-9, -, ., _, ~]).');
  }
  const params = {
    client_id: clientId,
    code,
    redirect_uri: REDIRECT_URI,
    grant_type: 'authorization_code',
    code_verifier: verifierValue
  };
  if (clientSecret) {
    params.client_secret = clientSecret;
  }
  const body = new URLSearchParams(params);
  const res = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description || data.error || `Linear OAuth token exchange failed (HTTP ${res.status}).`);
  return data;
}

async function refreshAccessToken({ clientId, clientSecret, refreshToken }) {
  if (!refreshToken) throw new Error('A valid refresh token is required.');
  const params = {
    client_id: clientId,
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  };
  if (clientSecret) {
    params.client_secret = clientSecret;
  }
  const body = new URLSearchParams(params);
  const res = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description || data.error || `Linear OAuth token refresh failed (HTTP ${res.status}).`);
  return data;
}

module.exports = {
  LOOPBACK_PORT,
  REDIRECT_PATH,
  REDIRECT_URI,
  DEFAULT_SCOPE,
  DEFAULT_CLIENT_ID,
  randomState,
  generateCodeVerifier,
  generateCodeChallenge,
  isValidCodeVerifier,
  buildAuthorizationUrl,
  openLoopbackServer,
  waitForCallback,
  authorize,
  exchangeCodeForToken,
  refreshAccessToken
};
