const { refreshAccessToken, DEFAULT_CLIENT_ID } = require('./oauth');

// Returns the exact value to send as the Linear "Authorization" header,
// refreshing an OAuth access token first if it's expired or close to it.
async function getLinearAuthHeader(store) {
  const mode = store.data.settings.linearAuthMode || 'apiKey';
  if (mode !== 'oauth') {
    const apiKey = store.getSecret('linearToken');
    if (!apiKey) throw new Error('Linear API key is missing.');
    return apiKey;
  }
  const clientId = store.data.settings.linearOAuthClientId || DEFAULT_CLIENT_ID;
  const clientSecret = store.getSecret('linearOAuthClientSecret') || undefined;
  let accessToken = store.getSecret('linearAccessToken');
  if (!clientId || !accessToken) throw new Error('Linear is not connected. Use "Connect Linear" to authorize ORBIT via OAuth.');
  const expiresAt = store.data.settings.linearTokenExpiresAt;
  if (expiresAt && Date.now() > expiresAt - 60000) {
    const refreshToken = store.getSecret('linearRefreshToken');
    if (!refreshToken) throw new Error('The Linear OAuth session expired and has no refresh token. Reconnect Linear.');
    const refreshed = await refreshAccessToken({ clientId, clientSecret, refreshToken });
    accessToken = refreshed.access_token;
    store.setSecret('linearAccessToken', accessToken);
    if (refreshed.refresh_token) store.setSecret('linearRefreshToken', refreshed.refresh_token);
    store.setSettings({ linearTokenExpiresAt: refreshed.expires_in ? Date.now() + refreshed.expires_in * 1000 : null });
  }
  return `Bearer ${accessToken}`;
}

module.exports = { getLinearAuthHeader };
