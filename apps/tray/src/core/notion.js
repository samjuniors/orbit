const NOTION_API_ENDPOINT = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

function getPlainTextFromTitle(titleArray) {
  if (!Array.isArray(titleArray) || !titleArray.length) return 'Untitled';
  return titleArray.map(t => t?.plain_text || t?.text?.content || '').join('').trim() || 'Untitled';
}

function extractPageTitle(properties) {
  if (!properties || typeof properties !== 'object') return 'Untitled';
  for (const prop of Object.values(properties)) {
    if (prop && prop.type === 'title' && Array.isArray(prop.title)) {
      return getPlainTextFromTitle(prop.title);
    }
  }
  return 'Untitled';
}

async function verifyNotionToken(token) {
  if (!token || typeof token !== 'string') throw new Error('Notion integration token is required.');
  const trimmed = token.trim();
  if (!trimmed) throw new Error('Notion integration token cannot be empty.');

  const res = await fetch(`${NOTION_API_ENDPOINT}/users/me`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${trimmed}`,
      'Notion-Version': NOTION_VERSION
    }
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || `Notion API returned HTTP ${res.status}`);
  }

  const workspaceName = data.bot?.owner?.workspace_name || data.name || 'Notion Workspace';
  const botName = data.name || 'ORBIT Integration';

  return {
    id: data.id,
    name: botName,
    type: data.type || 'bot',
    workspaceName,
    avatarUrl: data.avatar_url || null
  };
}

async function searchNotionResources(token, filterType = null) {
  if (!token) throw new Error('Notion token is required.');
  const body = { page_size: 30 };
  if (filterType && (filterType === 'page' || filterType === 'database')) {
    body.filter = { value: filterType, property: 'object' };
  }

  const res = await fetch(`${NOTION_API_ENDPOINT}/search`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token.trim()}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || `Notion search returned HTTP ${res.status}`);
  }

  const results = (data.results || []).map(item => {
    const isDb = item.object === 'database';
    const title = isDb ? getPlainTextFromTitle(item.title) : extractPageTitle(item.properties);
    return {
      id: item.id,
      object: item.object,
      title,
      url: item.url || '',
      icon: item.icon?.emoji || null,
      lastEditedTime: item.last_edited_time || null
    };
  });

  const databases = results.filter(r => r.object === 'database');
  const pages = results.filter(r => r.object === 'page');

  return { results, databases, pages };
}

module.exports = {
  NOTION_API_ENDPOINT,
  NOTION_VERSION,
  verifyNotionToken,
  searchNotionResources
};
