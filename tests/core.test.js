const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAgentInvocation } = require('../src/core/agents');
test('Antigravity adapter uses headless print mode and never bypasses permissions', () => {
  const x = buildAgentInvocation({ id: 'antigravity', executable: 'agy.exe' }, 'C:\\repo', 'do task');
  assert.deepEqual(x.args.slice(0, 2), ['-p', 'do task']);
  assert.ok(x.args.includes('stream-json'));
  assert.ok(!x.args.some(a => a.includes('skip-permissions')));
});
test('OpenCode adapter uses the isolated worktree as its directory', () => {
  const x = buildAgentInvocation({ id: 'opencode', executable: 'opencode.exe' }, 'C:\\worktree', 'do task');
  assert.equal(x.args[0], 'run');
  assert.ok(x.args.includes('C:\\worktree'));
  assert.ok(x.args.includes('json'));
});
test('unknown agents are rejected rather than executed with guessed arguments', () => {
  assert.throws(() => buildAgentInvocation({ id: 'unknown', executable: 'x' }, '.', 'x'), /Unsupported agent/);
});
test('missing executable is rejected', () => {
  assert.throws(() => buildAgentInvocation({ id: 'opencode' }, '.', 'x'), /No executable/);
});
const { getPermissions, withinActiveHours, DEFAULT_PERMISSIONS } = require('../src/core/permissions');
test('getPermissions defaults to supervised with approval required', () => {
  const p = getPermissions({});
  assert.equal(p.autonomyLevel, 'supervised');
  assert.equal(p.requireApprovalToRun, true);
  assert.equal(p.allowClaim, true);
});
test('getPermissions merges stored overrides without losing untouched defaults', () => {
  const p = getPermissions({ permissions: { autonomyLevel: 'autonomous', allowComment: false } });
  assert.equal(p.autonomyLevel, 'autonomous');
  assert.equal(p.allowComment, false);
  assert.equal(p.allowAgentRun, true); // untouched default preserved
  assert.deepEqual(p.activeHours, DEFAULT_PERMISSIONS.activeHours);
});
test('withinActiveHours is always true when the window is disabled', () => {
  assert.equal(withinActiveHours(getPermissions({})), true);
});
test('withinActiveHours respects a same-day window', () => {
  const p = getPermissions({ permissions: { activeHours: { enabled: true, start: '09:00', end: '18:00' } } });
  assert.equal(withinActiveHours(p, new Date(2026, 0, 1, 12, 0)), true);
  assert.equal(withinActiveHours(p, new Date(2026, 0, 1, 21, 0)), false);
});
test('withinActiveHours supports an overnight window', () => {
  const p = getPermissions({ permissions: { activeHours: { enabled: true, start: '22:00', end: '06:00' } } });
  assert.equal(withinActiveHours(p, new Date(2026, 0, 1, 23, 0)), true);
  assert.equal(withinActiveHours(p, new Date(2026, 0, 1, 2, 0)), true);
  assert.equal(withinActiveHours(p, new Date(2026, 0, 1, 12, 0)), false);
});

const http = require('node:http');
const {
  buildAuthorizationUrl,
  generateCodeVerifier,
  generateCodeChallenge,
  isValidCodeVerifier,
  exchangeCodeForToken,
  waitForCallback,
  authorize,
  REDIRECT_URI,
  REDIRECT_PATH,
  DEFAULT_SCOPE
} = require('../src/core/oauth');

test('buildAuthorizationUrl points at Linear with a fixed loopback redirect', () => {
  const url = new URL(buildAuthorizationUrl({ clientId: 'abc123', state: 'xyz' }));
  assert.equal(url.origin, 'https://linear.app');
  assert.equal(url.pathname, '/oauth/authorize');
  assert.equal(url.searchParams.get('client_id'), 'abc123');
  assert.equal(url.searchParams.get('redirect_uri'), REDIRECT_URI);
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('state'), 'xyz');
});

test('generateCodeVerifier creates a valid base64url string with RFC 7636 length', () => {
  const verifier = generateCodeVerifier();
  assert.equal(typeof verifier, 'string');
  assert.ok(verifier.length >= 43 && verifier.length <= 128);
  assert.match(verifier, /^[A-Za-z0-9_-]+$/);
});

test('generateCodeVerifier produces high-entropy cryptographically random verifiers', () => {
  const count = 50;
  const verifiers = Array.from({ length: count }, () => generateCodeVerifier());
  const uniqueVerifiers = new Set(verifiers);
  assert.equal(uniqueVerifiers.size, count);
  for (const v of verifiers) {
    assert.equal(v.length, 43);
    assert.match(v, /^[A-Za-z0-9_-]{43}$/);
  }
});

test('generateCodeChallenge calculates correct SHA-256 Base64URL challenge matching RFC 7636 Appendix B', () => {
  const rfcVerifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const expectedChallenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
  const challenge = generateCodeChallenge(rfcVerifier);
  assert.equal(challenge, expectedChallenge);
});

test('isValidCodeVerifier validates RFC 7636 length and unreserved characters', () => {
  assert.equal(isValidCodeVerifier('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), true); // 43 chars
  assert.equal(isValidCodeVerifier('a'.repeat(43)), true);
  assert.equal(isValidCodeVerifier('a'.repeat(128)), true);
  assert.equal(isValidCodeVerifier('abcABC012-._~' + 'x'.repeat(30)), true);

  assert.equal(isValidCodeVerifier(''), false);
  assert.equal(isValidCodeVerifier(null), false);
  assert.equal(isValidCodeVerifier(undefined), false);
  assert.equal(isValidCodeVerifier(12345), false);
  assert.equal(isValidCodeVerifier('a'.repeat(42)), false); // too short
  assert.equal(isValidCodeVerifier('a'.repeat(129)), false); // too long
  assert.equal(isValidCodeVerifier('a'.repeat(42) + ' '), false); // space
  assert.equal(isValidCodeVerifier('a'.repeat(42) + '!'), false); // invalid char
  assert.equal(isValidCodeVerifier('a'.repeat(42) + '@'), false); // invalid char
});

test('generateCodeChallenge rejects empty, non-string, or invalid verifier input', () => {
  assert.throws(() => generateCodeChallenge(''), /code_verifier/i);
  assert.throws(() => generateCodeChallenge(null), /code_verifier/i);
  assert.throws(() => generateCodeChallenge('short'), /code_verifier/i);
  assert.throws(() => generateCodeChallenge('a'.repeat(129)), /code_verifier/i);
});

test('buildAuthorizationUrl contains code_challenge, code_challenge_method=S256, and preserves existing parameters', () => {
  const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
  const url = new URL(buildAuthorizationUrl({
    clientId: 'lin_client_test',
    state: 'state_xyz_123',
    codeChallenge: challenge
  }));
  assert.equal(url.origin, 'https://linear.app');
  assert.equal(url.pathname, '/oauth/authorize');
  assert.equal(url.searchParams.get('client_id'), 'lin_client_test');
  assert.equal(url.searchParams.get('redirect_uri'), REDIRECT_URI);
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('scope'), DEFAULT_SCOPE);
  assert.equal(url.searchParams.get('state'), 'state_xyz_123');
  assert.equal(url.searchParams.get('prompt'), 'consent');
  assert.equal(url.searchParams.get('code_challenge'), challenge);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
});

test('buildAuthorizationUrl computes code_challenge when codeVerifier is passed directly', () => {
  const rfcVerifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const url = new URL(buildAuthorizationUrl({
    clientId: 'lin_client_test',
    state: 'state_abc',
    codeVerifier: rfcVerifier
  }));
  assert.equal(url.searchParams.get('code_challenge'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
});

test('buildAuthorizationUrl rejects plain and unsupported code_challenge_method', () => {
  assert.throws(
    () => buildAuthorizationUrl({ clientId: 'cid', state: 'st', codeChallengeMethod: 'plain' }),
    /unsupported codechallengemethod.*plain/i
  );
  assert.throws(
    () => buildAuthorizationUrl({ clientId: 'cid', state: 'st', code_challenge_method: 'plain' }),
    /unsupported code_challenge_method.*plain/i
  );
  assert.throws(
    () => buildAuthorizationUrl({ clientId: 'cid', state: 'st', codeChallengeMethod: 'S128' }),
    /unsupported codechallengemethod.*S128/i
  );
  assert.throws(
    () => buildAuthorizationUrl({ clientId: 'cid', state: 'st', code_challenge_method: 'none' }),
    /unsupported code_challenge_method.*none/i
  );
});

test('buildAuthorizationUrl rejects conflicting challenge method aliases', () => {
  assert.throws(
    () => buildAuthorizationUrl({ clientId: 'cid', state: 'st', codeChallengeMethod: 'S256', code_challenge_method: 'plain' }),
    /conflicting code challenge methods/i
  );
  assert.throws(
    () => buildAuthorizationUrl({ clientId: 'cid', state: 'st', codeChallengeMethod: 'plain', code_challenge_method: 'S256' }),
    /conflicting code challenge methods/i
  );
  assert.throws(
    () => buildAuthorizationUrl({ clientId: 'cid', state: 'st', codeChallengeMethod: 'S256', code_challenge_method: 'other' }),
    /conflicting code challenge methods/i
  );
});

test('buildAuthorizationUrl always enforces S256 when challenge is provided', () => {
  const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
  const url1 = new URL(buildAuthorizationUrl({ clientId: 'cid', state: 'st', codeChallenge: challenge }));
  assert.equal(url1.searchParams.get('code_challenge_method'), 'S256');

  const url2 = new URL(buildAuthorizationUrl({ clientId: 'cid', state: 'st', codeChallenge: challenge, codeChallengeMethod: 'S256' }));
  assert.equal(url2.searchParams.get('code_challenge_method'), 'S256');

  const url3 = new URL(buildAuthorizationUrl({ clientId: 'cid', state: 'st', codeChallenge: challenge, code_challenge_method: 'S256' }));
  assert.equal(url3.searchParams.get('code_challenge_method'), 'S256');

  const url4 = new URL(buildAuthorizationUrl({ clientId: 'cid', state: 'st', codeChallenge: challenge, codeChallengeMethod: 'S256', code_challenge_method: 'S256' }));
  assert.equal(url4.searchParams.get('code_challenge_method'), 'S256');
});

test('exchangeCodeForToken includes code_verifier in request payload', async () => {
  const originalFetch = globalThis.fetch;
  try {
    let capturedUrl, capturedMethod, capturedHeaders, capturedBody;
    globalThis.fetch = async (url, options) => {
      capturedUrl = url;
      capturedMethod = options.method;
      capturedHeaders = options.headers;
      capturedBody = new URLSearchParams(options.body);
      return {
        ok: true,
        json: async () => ({
          access_token: 'lin_access_token_123',
          refresh_token: 'lin_refresh_token_456',
          expires_in: 3600
        })
      };
    };

    const tokens = await exchangeCodeForToken({
      clientId: 'test_client_id',
      clientSecret: 'test_client_secret',
      code: 'test_auth_code',
      verifier: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    });

    assert.equal(capturedUrl, 'https://api.linear.app/oauth/token');
    assert.equal(capturedMethod, 'POST');
    assert.equal(capturedHeaders['Content-Type'], 'application/x-www-form-urlencoded');
    assert.equal(capturedBody.get('grant_type'), 'authorization_code');
    assert.equal(capturedBody.get('client_id'), 'test_client_id');
    assert.equal(capturedBody.get('client_secret'), 'test_client_secret');
    assert.equal(capturedBody.get('code'), 'test_auth_code');
    assert.equal(capturedBody.get('redirect_uri'), REDIRECT_URI);
    assert.equal(capturedBody.get('code_verifier'), 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk');
    assert.equal(tokens.access_token, 'lin_access_token_123');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('exchangeCodeForToken accepts codeVerifier alias and includes code_verifier in payload', async () => {
  const originalFetch = globalThis.fetch;
  try {
    let capturedBody;
    globalThis.fetch = async (_url, options) => {
      capturedBody = new URLSearchParams(options.body);
      return { ok: true, json: async () => ({ access_token: 'tok' }) };
    };

    await exchangeCodeForToken({
      clientId: 'cid',
      clientSecret: 'csec',
      code: 'code',
      codeVerifier: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    });

    assert.equal(capturedBody.get('code_verifier'), 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('exchangeCodeForToken rejects when verifier is missing before making HTTP request', async () => {
  let fetchCalled = false;
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => { fetchCalled = true; return { ok: true }; };
    await assert.rejects(
      () => exchangeCodeForToken({ clientId: 'cid', clientSecret: 'csec', code: 'auth123' }),
      /A valid PKCE code_verifier is required/i
    );
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('exchangeCodeForToken rejects empty, non-string, or invalid verifiers before making HTTP request', async () => {
  let fetchCalled = false;
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => { fetchCalled = true; return { ok: true }; };

    // Empty string
    await assert.rejects(
      () => exchangeCodeForToken({ clientId: 'cid', clientSecret: 'csec', code: 'c', verifier: '' }),
      /A valid PKCE code_verifier is required/i
    );
    // Non-string
    await assert.rejects(
      () => exchangeCodeForToken({ clientId: 'cid', clientSecret: 'csec', code: 'c', verifier: 12345 }),
      /A valid PKCE code_verifier is required/i
    );
    await assert.rejects(
      () => exchangeCodeForToken({ clientId: 'cid', clientSecret: 'csec', code: 'c', verifier: null }),
      /A valid PKCE code_verifier is required/i
    );
    // Too short (< 43 characters)
    await assert.rejects(
      () => exchangeCodeForToken({ clientId: 'cid', clientSecret: 'csec', code: 'c', verifier: 'a'.repeat(42) }),
      /A valid PKCE code_verifier is required/i
    );
    // Too long (> 128 characters)
    await assert.rejects(
      () => exchangeCodeForToken({ clientId: 'cid', clientSecret: 'csec', code: 'c', verifier: 'a'.repeat(129) }),
      /A valid PKCE code_verifier is required/i
    );
    // Invalid characters
    await assert.rejects(
      () => exchangeCodeForToken({ clientId: 'cid', clientSecret: 'csec', code: 'c', verifier: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk!' }),
      /A valid PKCE code_verifier is required/i
    );

    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('exchangeCodeForToken rejects conflicting verifier aliases', async () => {
  const v1 = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const v2 = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjX2';
  await assert.rejects(
    () => exchangeCodeForToken({ clientId: 'cid', clientSecret: 'csec', code: 'c', verifier: v1, codeVerifier: v2 }),
    /conflicting code verifier/i
  );
  await assert.rejects(
    () => exchangeCodeForToken({ clientId: 'cid', clientSecret: 'csec', code: 'c', verifier: v1, code_verifier: v2 }),
    /conflicting code verifier/i
  );
  await assert.rejects(
    () => exchangeCodeForToken({ clientId: 'cid', clientSecret: 'csec', code: 'c', codeVerifier: v1, code_verifier: v2 }),
    /conflicting code verifier/i
  );
});

test('waitForCallback rejects mismatched state even when an OAuth error is returned', async () => {
  const server = http.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const waitPromise = waitForCallback(server, 'expected_state_safe', 2000);
  const rejectCheck = assert.rejects(waitPromise, /OAuth state mismatch/);

  await fetch(`http://127.0.0.1:${port}${REDIRECT_PATH}?error=access_denied&state=tampered_state`);
  await rejectCheck;
});

test('waitForCallback rejects mismatched state when an authorization code is returned', async () => {
  const server = http.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const waitPromise = waitForCallback(server, 'expected_state_safe', 2000);
  const rejectCheck = assert.rejects(waitPromise, /OAuth state mismatch/);

  await fetch(`http://127.0.0.1:${port}${REDIRECT_PATH}?code=auth_code_123&state=wrong_state`);
  await rejectCheck;
});

test('waitForCallback rejects when state is missing altogether', async () => {
  const server = http.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const waitPromise = waitForCallback(server, 'expected_state_safe', 2000);
  const rejectCheck = assert.rejects(waitPromise, /OAuth state mismatch/);

  await fetch(`http://127.0.0.1:${port}${REDIRECT_PATH}?code=auth_code_123`);
  await rejectCheck;
});

test('waitForCallback reports OAuth error when state matches', async () => {
  const server = http.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const waitPromise = waitForCallback(server, 'matching_valid_state', 2000);
  const rejectCheck = assert.rejects(waitPromise, /Linear denied authorization: user_cancelled/);

  await fetch(`http://127.0.0.1:${port}${REDIRECT_PATH}?error=user_cancelled&state=matching_valid_state`);
  await rejectCheck;
});

test('waitForCallback resolves with code when state matches and no error occurred', async () => {
  const server = http.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const waitPromise = waitForCallback(server, 'matching_valid_state', 2000);
  const res = await fetch(`http://127.0.0.1:${port}${REDIRECT_PATH}?code=secret_auth_code_456&state=matching_valid_state`);
  assert.equal(res.status, 200);
  const result = await waitPromise;
  assert.deepEqual(result, { code: 'secret_auth_code_456' });
});

test('waitForCallback ignores requests to paths other than REDIRECT_PATH', async () => {
  const server = http.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const waitPromise = waitForCallback(server, 'state_for_path_test', 2000);
  const resWrong = await fetch(`http://127.0.0.1:${port}/some/random/path?code=123&state=state_for_path_test`);
  assert.equal(resWrong.status, 404);

  const resValid = await fetch(`http://127.0.0.1:${port}${REDIRECT_PATH}?code=actual_code&state=state_for_path_test`);
  assert.equal(resValid.status, 200);
  const result = await waitPromise;
  assert.deepEqual(result, { code: 'actual_code' });
});

test('authorize() generates a verifier, returns it, and embeds matching S256 challenge in the auth URL', async () => {
  const { authUrl, redirectUri, verifier, waitForCode } = await authorize({ clientId: 'test_client_id_456' });
  try {
    assert.equal(typeof verifier, 'string');
    assert.ok(verifier.length >= 43 && verifier.length <= 128);
    assert.equal(redirectUri, REDIRECT_URI);
    const expectedChallenge = generateCodeChallenge(verifier);
    const url = new URL(authUrl);
    assert.equal(url.searchParams.get('code_challenge'), expectedChallenge);
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(url.searchParams.get('client_id'), 'test_client_id_456');
  } finally {
    const state = new URL(authUrl).searchParams.get('state');
    await fetch(`${REDIRECT_URI}?code=dummy_code&state=${state}`);
    await waitForCode();
  }
});

test('authorize() throws if clientId is missing', async () => {
  await assert.rejects(() => authorize({}), /Linear OAuth Client ID/);
});

const { getLinearAuthHeader } = require('../src/core/linear-auth');
function fakeStore(settings, secrets) {
  return {
    data: { settings },
    getSecret: key => secrets[key] || '',
    setSecret: (key, value) => { secrets[key] = value; },
    setSettings: patch => Object.assign(settings, patch)
  };
}
test('getLinearAuthHeader returns the raw key for legacy API-key mode', async () => {
  const store = fakeStore({ linearAuthMode: 'apiKey' }, { linearToken: 'lin_api_xyz' });
  assert.equal(await getLinearAuthHeader(store), 'lin_api_xyz');
});
test('getLinearAuthHeader rejects legacy mode with no key configured', async () => {
  const store = fakeStore({ linearAuthMode: 'apiKey' }, {});
  await assert.rejects(() => getLinearAuthHeader(store), /API key is missing/);
});
test('getLinearAuthHeader returns a Bearer token for OAuth mode without requiring a refresh', async () => {
  const store = fakeStore(
    { linearAuthMode: 'oauth', linearOAuthClientId: 'cid', linearTokenExpiresAt: Date.now() + 3600000 },
    { linearAccessToken: 'tok_abc', linearOAuthClientSecret: 'secret' }
  );
  assert.equal(await getLinearAuthHeader(store), 'Bearer tok_abc');
});
test('getLinearAuthHeader rejects OAuth mode before a connection has been made', async () => {
  const store = fakeStore({ linearAuthMode: 'oauth' }, {});
  await assert.rejects(() => getLinearAuthHeader(store), /not connected/);
});

const { withinDailyLimit, describeAutonomyLevel, buildGuardEnv, cleanupGuard, AUTONOMY_LEVELS } = require('../src/core/permissions');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

test('withinDailyLimit counts only completed/failed runs in the last 24h', () => {
  const p = getPermissions({ permissions: { maxTasksPerDay: 2 } });
  const now = new Date(2026, 0, 2, 12, 0);
  const history = [
    { outcome: 'completed', at: new Date(2026, 0, 2, 10, 0).toISOString() },
    { outcome: 'failed', at: new Date(2026, 0, 2, 9, 0).toISOString() },
    { outcome: 'completed', at: new Date(2025, 11, 30, 9, 0).toISOString() }, // outside the window
    { outcome: 'skipped', at: new Date(2026, 0, 2, 11, 0).toISOString() }     // not counted
  ];
  assert.equal(withinDailyLimit(p, history, now), false); // 2 counted, cap is 2
});
test('withinDailyLimit is unlimited when maxTasksPerDay is 0', () => {
  const p = getPermissions({ permissions: { maxTasksPerDay: 0 } });
  assert.equal(withinDailyLimit(p, [{ outcome: 'completed', at: new Date().toISOString() }]), true);
});
test('withinDailyLimit and withinActiveHours both bypass caps in autonomous mode', () => {
  const p = getPermissions({ permissions: { autonomyLevel: 'autonomous', maxTasksPerDay: 1, activeHours: { enabled: true, start: '09:00', end: '10:00' } } });
  const manyRuns = Array.from({ length: 5 }, () => ({ outcome: 'completed', at: new Date().toISOString() }));
  assert.equal(withinDailyLimit(p, manyRuns), true);
  assert.equal(withinActiveHours(p, new Date(2026, 0, 1, 23, 0)), true);
});
test('describeAutonomyLevel returns distinct, non-empty text for every level', () => {
  const texts = AUTONOMY_LEVELS.map(describeAutonomyLevel);
  assert.equal(texts.length, new Set(texts).size);
  for (const t of texts) assert.ok(t.length > 10);
});
test('buildGuardEnv writes a git.cmd wrapper that encodes the current push/merge/PR permissions', () => {
  const guardRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-guard-test-'));
  const permissions = getPermissions({ permissions: { allowPush: true, allowMerge: false, allowPullRequest: true } });
  const { guardDir, extraEnv } = buildGuardEnv({ guardRoot, realGitPath: 'C:\\Git\\git.exe', realGhPath: 'C:\\gh\\gh.exe', permissions });
  assert.equal(extraEnv.ORBIT_ALLOW_PUSH, '1');
  assert.equal(extraEnv.ORBIT_ALLOW_MERGE, '0');
  assert.equal(extraEnv.ORBIT_ALLOW_PR, '1');
  assert.ok(extraEnv.PATH.startsWith(guardDir));
  assert.ok(fs.existsSync(path.join(guardDir, 'git.cmd')));
  assert.ok(fs.existsSync(path.join(guardDir, 'gh.cmd')));
  const gitScript = fs.readFileSync(path.join(guardDir, 'git.cmd'), 'utf8');
  assert.ok(gitScript.includes('ORBIT_ALLOW_PUSH'));
  assert.ok(gitScript.includes('force-push is never permitted'));
  cleanupGuard(guardDir);
  assert.equal(fs.existsSync(guardDir), false);
});
test('buildGuardEnv skips the gh.cmd wrapper when no GitHub CLI was discovered', () => {
  const guardRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-guard-test-'));
  const { guardDir } = buildGuardEnv({ guardRoot, realGitPath: 'git.exe', realGhPath: null, permissions: getPermissions({}) });
  assert.ok(fs.existsSync(path.join(guardDir, 'git.cmd')));
  assert.equal(fs.existsSync(path.join(guardDir, 'gh.cmd')), false);
  cleanupGuard(guardDir);
});

const { withinSchedule } = require('../src/core/schedule');
test('withinSchedule is always true when disabled or unset', () => {
  assert.equal(withinSchedule(null), true);
  assert.equal(withinSchedule({ enabled: false, start: '09:00', end: '18:00' }), true);
});
test('withinSchedule respects a same-day window', () => {
  const schedule = { enabled: true, start: '09:00', end: '18:00' };
  assert.equal(withinSchedule(schedule, new Date(2026, 0, 2, 12, 0)), true);
  assert.equal(withinSchedule(schedule, new Date(2026, 0, 2, 21, 0)), false);
});
test('withinSchedule respects an overnight window', () => {
  const schedule = { enabled: true, start: '22:00', end: '06:00' };
  assert.equal(withinSchedule(schedule, new Date(2026, 0, 2, 23, 0)), true);
  assert.equal(withinSchedule(schedule, new Date(2026, 0, 2, 2, 0)), true);
  assert.equal(withinSchedule(schedule, new Date(2026, 0, 2, 12, 0)), false);
});
test('withinSchedule respects a day-of-week restriction', () => {
  // 2026-01-03 is a Saturday (day 6); restrict to weekdays (1-5).
  const schedule = { enabled: true, start: '00:00', end: '23:59', days: [1, 2, 3, 4, 5] };
  assert.equal(withinSchedule(schedule, new Date(2026, 0, 3, 12, 0)), false);
  assert.equal(withinSchedule(schedule, new Date(2026, 0, 5, 12, 0)), true); // Monday
});

const { findObsidianVaults, probe } = require('../src/core/discovery');
const { shouldHideWindowOnClose, handleSecondInstance, buildTrayMenuTemplate, canAutoStartWorker } = require('../src/core/lifecycle');
const { Store } = require('../src/core/store');

test('findObsidianVaults returns installed: false and empty vaults when config file does not exist', () => {
  const missingPath = path.join(os.tmpdir(), 'orbit-nonexistent-obsidian-config.json');
  const res = findObsidianVaults(missingPath);
  assert.equal(res.installed, false);
  assert.deepEqual(res.vaults, []);
});

test('findObsidianVaults extracts existing vaults and filters out missing folders', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-obsidian-test-'));
  const vault1 = path.join(tmpDir, 'MyVault');
  const missingVault = path.join(tmpDir, 'OldVaultMissing');
  fs.mkdirSync(vault1, { recursive: true });

  const configFile = path.join(tmpDir, 'obsidian.json');
  fs.writeFileSync(configFile, JSON.stringify({
    vaults: {
      'v1': { path: vault1, ts: 123456 },
      'v2': { path: missingVault, ts: 123457 }
    }
  }), 'utf8');

  const res = findObsidianVaults(configFile);
  assert.equal(res.installed, true);
  assert.equal(res.vaults.length, 1);
  assert.equal(res.vaults[0].name, 'MyVault');
  assert.equal(res.vaults[0].path, vault1);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('findObsidianVaults handles corrupted or non-object obsidian config gracefully', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-obsidian-bad-'));
  const configFile = path.join(tmpDir, 'obsidian.json');
  fs.writeFileSync(configFile, 'INVALID JSON DATA', 'utf8');

  const res = findObsidianVaults(configFile);
  assert.equal(res.installed, false);
  assert.deepEqual(res.vaults, []);

  fs.writeFileSync(configFile, JSON.stringify({ vaults: null }), 'utf8');
  const res2 = findObsidianVaults(configFile);
  assert.equal(res2.installed, true);
  assert.deepEqual(res2.vaults, []);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('probe gracefully handles nonexistent command without throwing', async () => {
  const res = await probe('FakeTool', ['definitely-nonexistent-orbit-cmd-999.exe']);
  assert.equal(res.label, 'FakeTool');
  assert.equal(res.installed, false);
  assert.deepEqual(res.candidates, ['definitely-nonexistent-orbit-cmd-999.exe']);
});

test('shouldHideWindowOnClose returns true when application is not quitting (close-to-tray)', () => {
  assert.equal(shouldHideWindowOnClose({ isQuitting: false }), true);
  assert.equal(shouldHideWindowOnClose({ isQuitting: undefined }), true);
});

test('shouldHideWindowOnClose returns false during explicit application quit', () => {
  assert.equal(shouldHideWindowOnClose({ isQuitting: true }), false);
});

test('handleSecondInstance restores, shows, and focuses mainWindow when second instance is launched', () => {
  const actions = [];
  let isMinimized = true;
  const mockWindow = {
    isMinimized: () => isMinimized,
    restore: () => { actions.push('restore'); isMinimized = false; },
    show: () => actions.push('show'),
    focus: () => actions.push('focus')
  };

  const handled = handleSecondInstance({ mainWindow: mockWindow });
  assert.equal(handled, true);
  assert.deepEqual(actions, ['restore', 'show', 'focus']);
});

test('handleSecondInstance returns false when mainWindow is not available', () => {
  assert.equal(handleSecondInstance({ mainWindow: null }), false);
  assert.equal(handleSecondInstance({ mainWindow: undefined }), false);
});

test('buildTrayMenuTemplate creates menu with Pause queue when worker is running', () => {
  const calls = [];
  const template = buildTrayMenuTemplate({
    isPaused: false,
    onOpen: () => calls.push('open'),
    onTogglePause: val => calls.push(`pause:${val}`),
    onSettings: () => calls.push('settings'),
    onQuit: () => calls.push('quit')
  });

  assert.equal(template[0].label, 'Open ORBIT');
  assert.equal(template[1].label, 'Pause queue');
  assert.equal(template[2].label, 'Settings');
  assert.equal(template[3].type, 'separator');
  assert.equal(template[4].label, 'Quit ORBIT');

  template[0].click();
  template[1].click();
  template[2].click();
  template[4].click();

  assert.deepEqual(calls, ['open', 'pause:true', 'settings', 'quit']);
});

test('buildTrayMenuTemplate creates menu with Resume queue when worker is paused', () => {
  const calls = [];
  const template = buildTrayMenuTemplate({
    isPaused: true,
    onTogglePause: val => calls.push(`pause:${val}`)
  });

  assert.equal(template[1].label, 'Resume queue');
  template[1].click();
  assert.deepEqual(calls, ['pause:false']);
});

test('canAutoStartWorker requires completed onboarding and enabled autoRun without schedule', () => {
  assert.equal(canAutoStartWorker({ settings: null }), false);
  assert.equal(canAutoStartWorker({ settings: {} }), false);
  assert.equal(canAutoStartWorker({ settings: { onboardingComplete: false } }), false);
  assert.equal(canAutoStartWorker({ settings: { onboardingComplete: true, autoRunEnabled: false } }), false);
  assert.equal(canAutoStartWorker({ settings: { onboardingComplete: true, schedule: { enabled: true } } }), false);

  assert.equal(canAutoStartWorker({ settings: { onboardingComplete: true } }), true);
  assert.equal(canAutoStartWorker({ settings: { onboardingComplete: true, autoRunEnabled: true } }), true);
});

test('Store persists and restores onboardingComplete status and public settings across restarts', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-store-test-'));
  const mockApp = { getPath: () => tmpDir };
  const mockSafeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: str => Buffer.from(`enc:${str}`),
    decryptString: buf => buf.toString().replace(/^enc:/, '')
  };

  const store1 = new Store(mockApp, mockSafeStorage);
  assert.equal(store1.getPublic().settings.onboardingComplete, undefined);

  store1.setSettings({ onboardingComplete: true, agentId: 'antigravity', projectName: 'TestProject' });
  store1.setSecret('linearToken', 'secret-api-token-123');

  const pub1 = store1.getPublic();
  assert.equal(pub1.settings.onboardingComplete, true);
  assert.equal(pub1.settings.agentId, 'antigravity');
  assert.equal(pub1.settings.hasLinearApiKey, true);
  assert.equal(pub1.settings.linearTokenEncrypted, undefined); // Never exposed

  // Simulate app restart by constructing new Store from the same directory
  const store2 = new Store(mockApp, mockSafeStorage);
  const pub2 = store2.getPublic();
  assert.equal(pub2.settings.onboardingComplete, true);
  assert.equal(pub2.settings.agentId, 'antigravity');
  assert.equal(pub2.settings.projectName, 'TestProject');
  assert.equal(pub2.settings.hasLinearApiKey, true);
  assert.equal(store2.getSecret('linearToken'), 'secret-api-token-123');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const { fetchWorkspaceContext } = require('../src/core/linear');
const { refreshAccessToken } = require('../src/core/oauth');

test('exchangeCodeForToken supports public PKCE without clientSecret and omits client_secret from payload', async () => {
  const originalFetch = globalThis.fetch;
  try {
    let capturedBody;
    globalThis.fetch = async (_url, options) => {
      capturedBody = new URLSearchParams(options.body);
      return {
        ok: true,
        json: async () => ({
          access_token: 'pkce_access_token',
          token_type: 'Bearer',
          expires_in: 3600
        })
      };
    };

    const tokens = await exchangeCodeForToken({
      clientId: 'orbit-desktop-worker',
      code: 'auth_code_pkce_123',
      verifier: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    });

    assert.equal(capturedBody.get('grant_type'), 'authorization_code');
    assert.equal(capturedBody.get('client_id'), 'orbit-desktop-worker');
    assert.equal(capturedBody.get('code'), 'auth_code_pkce_123');
    assert.equal(capturedBody.get('code_verifier'), 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk');
    assert.equal(capturedBody.has('client_secret'), false);
    assert.equal(tokens.access_token, 'pkce_access_token');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('refreshAccessToken supports public PKCE and omits client_secret when none is provided', async () => {
  const originalFetch = globalThis.fetch;
  try {
    let capturedBody;
    globalThis.fetch = async (_url, options) => {
      capturedBody = new URLSearchParams(options.body);
      return {
        ok: true,
        json: async () => ({
          access_token: 'refreshed_access_token',
          refresh_token: 'new_refresh_token',
          expires_in: 3600
        })
      };
    };

    const res = await refreshAccessToken({
      clientId: 'orbit-desktop-worker',
      refreshToken: 'old_refresh_token'
    });

    assert.equal(capturedBody.get('grant_type'), 'refresh_token');
    assert.equal(capturedBody.get('client_id'), 'orbit-desktop-worker');
    assert.equal(capturedBody.get('refresh_token'), 'old_refresh_token');
    assert.equal(capturedBody.has('client_secret'), false);
    assert.equal(res.access_token, 'refreshed_access_token');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('authorize() supports user cancellation via cancel() and frees loopback port', async () => {
  const auth1 = await authorize({ clientId: 'test_cancel_client' });
  assert.equal(typeof auth1.cancel, 'function');

  // Cancel the first authorization attempt
  auth1.cancel();

  await assert.rejects(() => auth1.waitForCode(), /cancelled/i);

  // Verifying the port is freed: a second authorize() call should succeed immediately without EADDRINUSE
  const auth2 = await authorize({ clientId: 'test_cancel_client_2' });
  try {
    assert.ok(auth2.authUrl.includes('client_id=test_cancel_client_2'));
  } finally {
    auth2.cancel();
    await auth2.waitForCode().catch(() => {});
  }
});

test('fetchWorkspaceContext parses viewer, organization, teams, states, and projects correctly', async () => {
  const originalFetch = globalThis.fetch;
  try {
    let capturedQuery;
    globalThis.fetch = async (_url, options) => {
      capturedQuery = JSON.parse(options.body).query;
      return {
        ok: true,
        json: async () => ({
          data: {
            viewer: { id: 'usr_123', name: 'Alice Developer', email: 'alice@example.com' },
            organization: { id: 'org_456', name: 'Orbit HQ', urlKey: 'orbithq' },
            teams: {
              nodes: [
                {
                  id: 'team_1',
                  key: 'ENG',
                  name: 'Engineering',
                  states: {
                    nodes: [
                      { id: 'st_1', name: 'Ready for ORBIT', type: 'unstarted' },
                      { id: 'st_2', name: 'In Progress', type: 'started' },
                      { id: 'st_3', name: 'In Review', type: 'started' }
                    ]
                  },
                  projects: {
                    nodes: [
                      { id: 'proj_1', name: 'Desktop Worker', state: 'started' },
                      { id: 'proj_2', name: 'Cloud API', state: 'planned' }
                    ]
                  }
                }
              ]
            }
          }
        })
      };
    };

    const ctx = await fetchWorkspaceContext('Bearer test_valid_token');
    assert.ok(capturedQuery.includes('OrbitWorkspaceContext'));
    assert.equal(ctx.organization.name, 'Orbit HQ');
    assert.equal(ctx.organization.urlKey, 'orbithq');
    assert.equal(ctx.viewer.name, 'Alice Developer');
    assert.equal(ctx.viewer.email, 'alice@example.com');
    assert.equal(ctx.teams.length, 1);
    assert.equal(ctx.teams[0].key, 'ENG');
    assert.equal(ctx.teams[0].states.length, 3);
    assert.equal(ctx.teams[0].projects.length, 2);
    assert.equal(ctx.teams[0].projects[0].name, 'Desktop Worker');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchWorkspaceContext handles empty nodes and null fields gracefully', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ data: {} })
    });

    const ctx = await fetchWorkspaceContext('Bearer token');
    assert.equal(ctx.organization.name, 'Linear Workspace');
    assert.equal(ctx.viewer.name, '');
    assert.deepEqual(ctx.teams, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('getLinearAuthHeader supports public PKCE mode without requiring clientSecret', async () => {
  const store = fakeStore(
    { linearAuthMode: 'oauth', linearOAuthClientId: 'orbit-desktop-worker', linearTokenExpiresAt: Date.now() + 3600000 },
    { linearAccessToken: 'pkce_bearer_123' }
  );
  const header = await getLinearAuthHeader(store);
  assert.equal(header, 'Bearer pkce_bearer_123');
});

test('Store persists OAuth tokens via DPAPI encryption and clearLinearAuth clears all connection state', () => {
  const tmpDir = path.join(os.tmpdir(), `orbit-store-oauth-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const mockApp = { getPath: () => tmpDir };
  const mockSafeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: str => Buffer.from(`dpapi:${str}`),
    decryptString: buf => buf.toString().replace(/^dpapi:/, '')
  };

  const store = new Store(mockApp, mockSafeStorage);
  store.setSecret('linearAccessToken', 'access-tok-dpapi');
  store.setSecret('linearRefreshToken', 'refresh-tok-dpapi');
  store.setSettings({
    linearOAuthClientId: 'orbit-desktop-worker',
    linearAuthMode: 'oauth',
    linearWorkspaceName: 'Acme Software',
    linearWorkspaceKey: 'acme',
    linearTeamKey: 'ENG',
    linearTeamName: 'Engineering',
    linearProjectId: 'proj_101',
    linearProjectName: 'Worker V2',
    linearTeams: [{ id: 't1', key: 'ENG', name: 'Engineering' }],
    inProgressStateId: 'st_ip',
    reviewStateId: 'st_rev'
  });

  const pub = store.getPublic();
  assert.equal(pub.settings.hasLinearOAuth, true);
  assert.equal(pub.settings.linearWorkspaceName, 'Acme Software');
  assert.equal(pub.settings.linearTeamKey, 'ENG');
  assert.equal(pub.settings.linearProjectId, 'proj_101');
  assert.equal(pub.settings.linearAccessTokenEncrypted, undefined); // Token never leaked to public

  // Decrypt works internally
  assert.equal(store.getSecret('linearAccessToken'), 'access-tok-dpapi');
  assert.equal(store.getSecret('linearRefreshToken'), 'refresh-tok-dpapi');

  // Disconnect wipes tokens and resets workspace context
  store.clearLinearAuth();

  const pubAfter = store.getPublic();
  assert.equal(pubAfter.settings.hasLinearOAuth, false);
  assert.equal(pubAfter.settings.linearWorkspaceName, '');
  assert.equal(pubAfter.settings.linearTeamKey, '');
  assert.equal(pubAfter.settings.linearProjectId, '');
  assert.deepEqual(pubAfter.settings.linearTeams, []);
  assert.equal(store.getSecret('linearAccessToken'), '');
  assert.equal(store.getSecret('linearRefreshToken'), '');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const { verifyNotionToken, searchNotionResources } = require('../src/core/notion');
const { validateVault, readNoteSafe } = require('../src/core/obsidian');
const { verifyGithubAuth, fetchGithubRepositories } = require('../src/core/github');

test('verifyNotionToken parses bot and workspace name on successful API response', async () => {
  const origFetch = global.fetch;
  global.fetch = async (url, opts) => {
    assert.ok(url.includes('/users/me'));
    assert.equal(opts.headers.Authorization, 'Bearer secret_valid_token_123');
    assert.equal(opts.headers['Notion-Version'], '2022-06-28');
    return {
      ok: true,
      json: async () => ({
        id: 'bot_abc_123',
        name: 'ORBIT Integration',
        type: 'bot',
        bot: { owner: { type: 'workspace', workspace_name: 'Acme Research' } }
      })
    };
  };
  try {
    const res = await verifyNotionToken('secret_valid_token_123');
    assert.equal(res.id, 'bot_abc_123');
    assert.equal(res.workspaceName, 'Acme Research');
    assert.equal(res.name, 'ORBIT Integration');
  } finally {
    global.fetch = origFetch;
  }
});

test('verifyNotionToken rejects empty token or Notion API error', async () => {
  await assert.rejects(() => verifyNotionToken(''), /token is required|token cannot be empty/i);
  await assert.rejects(() => verifyNotionToken(null), /token is required/i);

  const origFetch = global.fetch;
  global.fetch = async () => ({
    ok: false,
    status: 401,
    json: async () => ({ message: 'API token is invalid.' })
  });
  try {
    await assert.rejects(() => verifyNotionToken('secret_invalid'), /API token is invalid/);
  } finally {
    global.fetch = origFetch;
  }
});

test('searchNotionResources separates databases and pages and extracts titles', async () => {
  const origFetch = global.fetch;
  global.fetch = async (url, opts) => {
    assert.ok(url.includes('/search'));
    return {
      ok: true,
      json: async () => ({
        results: [
          {
            id: 'db_1',
            object: 'database',
            title: [{ plain_text: 'Sprint Roadmap' }],
            url: 'https://notion.so/db_1'
          },
          {
            id: 'page_1',
            object: 'page',
            properties: {
              Name: { type: 'title', title: [{ plain_text: 'Product Spec' }] }
            },
            url: 'https://notion.so/page_1'
          }
        ]
      })
    };
  };
  try {
    const res = await searchNotionResources('secret_valid_token');
    assert.equal(res.results.length, 2);
    assert.equal(res.databases.length, 1);
    assert.equal(res.databases[0].title, 'Sprint Roadmap');
    assert.equal(res.pages.length, 1);
    assert.equal(res.pages[0].title, 'Product Spec');
  } finally {
    global.fetch = origFetch;
  }
});

test('validateVault validates folder existence, .obsidian folder, and read-only mode', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-vault-valid-'));
  const obsidianDir = path.join(tmpDir, '.obsidian');
  fs.mkdirSync(obsidianDir, { recursive: true });

  const res = validateVault(tmpDir);
  assert.equal(res.valid, true);
  assert.equal(res.name, path.basename(tmpDir));
  assert.equal(res.path, path.resolve(tmpDir));
  assert.equal(res.hasObsidianConfig, true);
  assert.equal(res.readOnly, true);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('validateVault rejects non-existent paths and files', () => {
  assert.throws(() => validateVault(''), /must be a non-empty string/);
  assert.throws(() => validateVault(path.join(os.tmpdir(), 'definitely-nonexistent-vault-999')), /does not exist/);

  const tmpFile = path.join(os.tmpdir(), 'orbit-not-a-vault.txt');
  fs.writeFileSync(tmpFile, 'hello');
  try {
    assert.throws(() => validateVault(tmpFile), /is a file, not a directory/);
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }
});

test('readNoteSafe reads vault note and prevents path traversal escapes', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-vault-notes-'));
  const noteFile = path.join(tmpDir, 'welcome.md');
  fs.writeFileSync(noteFile, '# Welcome to Vault');

  const content = readNoteSafe(tmpDir, 'welcome.md');
  assert.equal(content, '# Welcome to Vault');

  // Directory traversal attack attempt
  assert.throws(() => readNoteSafe(tmpDir, '../../etc/passwd'), /Access denied/);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('verifyGithubAuth parses user identity and scopes from headers and payload', async () => {
  const origFetch = global.fetch;
  global.fetch = async (url, opts) => {
    assert.ok(url.includes('/user'));
    assert.equal(opts.headers.Authorization, 'Bearer ghp_valid_token_123');
    return {
      ok: true,
      headers: {
        get: name => name.toLowerCase() === 'x-oauth-scopes' ? 'repo, read:org, user' : null
      },
      json: async () => ({
        login: 'octocat',
        name: 'The Octocat',
        avatar_url: 'https://github.com/images/error/octocat_happy.gif',
        html_url: 'https://github.com/octocat'
      })
    };
  };
  try {
    const res = await verifyGithubAuth({ token: 'ghp_valid_token_123' });
    assert.equal(res.login, 'octocat');
    assert.equal(res.name, 'The Octocat');
    assert.deepEqual(res.scopes, ['repo', 'read:org', 'user']);
    assert.equal(res.authSource, 'token');
  } finally {
    global.fetch = origFetch;
  }
});

test('fetchGithubRepositories extracts repo details and permissions', async () => {
  const origFetch = global.fetch;
  global.fetch = async (url, opts) => {
    assert.ok(url.includes('/user/repos'));
    return {
      ok: true,
      json: async () => [
        {
          id: 12345,
          name: 'orbit-worker',
          full_name: 'acme/orbit-worker',
          private: true,
          html_url: 'https://github.com/acme/orbit-worker',
          default_branch: 'main',
          permissions: { admin: true, push: true, pull: true }
        }
      ]
    };
  };
  try {
    const repos = await fetchGithubRepositories({ token: 'ghp_valid' });
    assert.equal(repos.length, 1);
    assert.equal(repos[0].name, 'orbit-worker');
    assert.equal(repos[0].private, true);
    assert.equal(repos[0].permissions.push, true);
  } finally {
    global.fetch = origFetch;
  }
});

test('Store persists multi-provider state via DPAPI and prevents secret exposure in getPublic', () => {
  const tmpDir = path.join(os.tmpdir(), `orbit-multi-provider-test-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const mockApp = { getPath: () => tmpDir };
  const mockSafeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: str => Buffer.from(`dpapi:${str}`),
    decryptString: buf => buf.toString().replace(/^dpapi:/, '')
  };

  const store = new Store(mockApp, mockSafeStorage);

  // Configure Notion
  store.setSecret('notionToken', 'secret_notion_key_xyz');
  store.setSettings({
    notionConnected: true,
    notionWorkspaceName: 'Acme Docs',
    notionBotName: 'ORBIT Bot'
  });

  // Configure Obsidian
  store.setSettings({
    obsidianConnected: true,
    obsidianVaultName: 'NotesVault',
    obsidianVaultPath: 'C:\\Users\\user\\Documents\\Notes',
    obsidianReadOnly: true
  });

  // Configure GitHub
  store.setSecret('githubToken', 'ghp_secret_github_token');
  store.setSettings({
    githubConnected: true,
    githubLogin: 'octocat',
    githubName: 'Octo User'
  });

  const pub = store.getPublic();

  // Status flags
  assert.equal(pub.settings.hasNotionConnected, true);
  assert.equal(pub.settings.hasObsidianConnected, true);
  assert.equal(pub.settings.hasGithubConnected, true);
  assert.equal(pub.settings.hasLinearConnected, false);

  // Metadata available
  assert.equal(pub.settings.notionWorkspaceName, 'Acme Docs');
  assert.equal(pub.settings.obsidianVaultName, 'NotesVault');
  assert.equal(pub.settings.githubLogin, 'octocat');

  // CRITICAL SECURITY: Secrets NEVER exposed in getPublic()
  assert.equal(pub.settings.notionTokenEncrypted, undefined);
  assert.equal(pub.settings.githubTokenEncrypted, undefined);

  // Disconnect tests
  store.clearNotionAuth();
  assert.equal(store.getPublic().settings.hasNotionConnected, false);
  assert.equal(store.getSecret('notionToken'), '');

  store.clearObsidianAuth();
  assert.equal(store.getPublic().settings.hasObsidianConnected, false);
  assert.equal(store.getPublic().settings.obsidianVaultPath, '');

  store.clearGithubAuth();
  assert.equal(store.getPublic().settings.hasGithubConnected, false);
  assert.equal(store.getSecret('githubToken'), '');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
