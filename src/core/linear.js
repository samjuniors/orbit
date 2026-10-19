const ENDPOINT = 'https://api.linear.app/graphql';

// Personal API keys go in Authorization as-is; OAuth access tokens need "Bearer ".
// See https://linear.app/developers/oauth-2-0-authentication
function formatAuthHeader(method, token) {
  if (!token) throw new Error('Linear is not connected yet.');
  return method === 'oauth' ? `Bearer ${token}` : token;
}

async function gql(authHeader, query, variables = {}) {
  const response = await fetch(ENDPOINT, { method: 'POST', headers: { Authorization: authHeader, 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.errors?.length) throw new Error(body.errors?.map(e => e.message).join('; ') || `Linear API returned HTTP ${response.status}`);
  return body.data;
}
async function inspectTeam(authHeader, teamKey) {
  const data = await gql(authHeader, `query OrbitTeam($key: String!) { teams(filter: { key: { eq: $key } }) { nodes { id key name states { nodes { id name type } } } } }`, { key: teamKey });
  const team = data.teams.nodes[0];
  if (!team) throw new Error(`No Linear team found for key "${teamKey}".`);
  return { id: team.id, key: team.key, name: team.name, states: team.states.nodes };
}
async function listReadyIssues(authHeader, teamKey, readyStateName) {
  const data = await gql(authHeader, `query OrbitReadyIssues($teamKey: String!, $stateName: String!) { issues(filter: { team: { key: { eq: $teamKey } }, state: { name: { eq: $stateName } } }, first: 25) { nodes { id identifier title description url createdAt state { id name } team { key name } project { name } labels { nodes { name } } } } }`, { teamKey, stateName: readyStateName });
  return data.issues.nodes;
}
async function updateIssueState(authHeader, issueId, stateId) {
  const data = await gql(authHeader, `mutation OrbitClaim($id: String!, $stateId: String!) { issueUpdate(id: $id, input: { stateId: $stateId }) { success issue { id identifier state { id name } } } }`, { id: issueId, stateId });
  if (!data.issueUpdate?.success) throw new Error('Linear did not accept the issue state transition.');
  return data.issueUpdate;
}
async function addIssueComment(authHeader, issueId, body) {
  const data = await gql(authHeader, `mutation OrbitComment($issueId: String!, $body: String!) { commentCreate(input: { issueId: $issueId, body: $body }) { success comment { id } } }`, { issueId, body });
  if (!data.commentCreate?.success) throw new Error('Linear did not accept the execution comment.');
  return data.commentCreate;
}
async function fetchWorkspaceContext(authHeader) {
  const query = `query OrbitWorkspaceContext {
    viewer { id name email }
    organization { id name urlKey }
    teams {
      nodes {
        id
        key
        name
        states { nodes { id name type } }
        projects { nodes { id name state } }
      }
    }
  }`;
  const data = await gql(authHeader, query);
  const organization = data?.organization || { id: '', name: 'Linear Workspace', urlKey: '' };
  const viewer = data?.viewer || { id: '', name: '', email: '' };
  const teams = (data?.teams?.nodes || []).map(t => ({
    id: t.id,
    key: t.key,
    name: t.name,
    states: (t.states?.nodes || []).map(s => ({ id: s.id, name: s.name, type: s.type })),
    projects: (t.projects?.nodes || []).map(p => ({ id: p.id, name: p.name, state: p.state }))
  }));
  return {
    organization: {
      id: organization.id || '',
      name: organization.name || 'Linear Workspace',
      urlKey: organization.urlKey || ''
    },
    viewer: {
      id: viewer.id || '',
      name: viewer.name || '',
      email: viewer.email || ''
    },
    teams
  };
}

module.exports = {
  inspectTeam,
  listReadyIssues,
  updateIssueState,
  addIssueComment,
  formatAuthHeader,
  fetchWorkspaceContext
};
