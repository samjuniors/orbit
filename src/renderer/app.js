const $ = id => document.getElementById(id);
let discovery = null;
let currentState = null;
let currentView = 'onboarding';
let currentStep = 1;
let cachedLinearTeams = [];
let isLinearWaiting = false;

const AUTONOMY_DESCRIPTIONS = {
  supervised: 'Claims eligible tasks, but waits for your approval before the agent actually runs.',
  delegated: 'Claims and runs eligible tasks automatically, limited by the daily cap and active hours below.',
  autonomous: 'Claims and runs eligible tasks automatically, with no daily cap or active-hours limit.'
};

function toast(s) {
  const e = $('toast');
  e.textContent = s;
  e.classList.remove('hidden');
  setTimeout(() => e.classList.add('hidden'), 4500);
}

function log(s) {
  const e = document.createElement('div');
  e.textContent = new Date().toLocaleTimeString() + '  ' + s;
  $('log').prepend(e);
  while ($('log').children.length > 80) $('log').lastChild.remove();
}

function showView(view) {
  currentView = view;
  $('onboardingView').classList.toggle('hidden', view !== 'onboarding');
  $('dashboardView').classList.toggle('hidden', view !== 'dashboard');
  $('settingsView').classList.toggle('hidden', view !== 'settings');

  $('navDashboard').classList.toggle('active', view === 'dashboard');
  $('navSettings').classList.toggle('active', view === 'settings');

  if (view === 'onboarding') {
    $('viewNav').classList.add('hidden');
  } else {
    $('viewNav').classList.remove('hidden');
  }
}

function showOnboardingStep(step) {
  currentStep = step;
  for (let i = 1; i <= 5; i++) {
    const el = $('onboardStep' + i);
    if (el) el.classList.toggle('hidden', i !== step);
    const tab = $('stepTab' + i);
    if (tab) {
      tab.classList.toggle('active', i === step);
      tab.classList.toggle('completed', i < step);
    }
  }
  if (step === 5) updateSummary();
}

function updateSummary() {
  const agentId = $('onboardAgentSelect').value || $('agent').value;
  const agentLabel = discovery?.tools?.[agentId]?.label || agentId || 'None selected';
  $('summaryAgent').textContent = agentLabel;

  const projectPath = $('onboardProjectPath').value || $('projectPath').value;
  const projectName = $('onboardProjectName').value || $('projectName').value;
  $('summaryWorkspace').textContent = projectPath ? `${projectName || 'Project'} (${projectPath})` : 'None selected';

  const teamKey = $('onboardTeamKey').value || $('teamKey').value;
  const teamName = currentState?.settings?.linearTeamName || '';
  const projName = currentState?.settings?.linearProjectName || '';
  const wsName = currentState?.settings?.linearWorkspaceName || '';
  const isOauth = (currentState?.settings?.linearAuthMode || 'oauth') === 'oauth';
  const connected = currentState?.settings?.hasLinearOAuth || currentState?.settings?.hasLinearApiKey;

  if (connected) {
    const parts = [];
    if (wsName) parts.push(wsName);
    if (teamName || teamKey) parts.push(teamName ? `${teamName} (${teamKey})` : teamKey);
    if (projName) parts.push(`Project: ${projName}`);
    $('summaryLinear').textContent = `Connected · ${parts.join(' · ') || (isOauth ? 'OAuth PKCE' : 'API Key')}`;
  } else {
    $('summaryLinear').textContent = teamKey ? `Configured (Team: ${teamKey})` : 'Not connected';
  }

  $('summarySafety').textContent = 'Supervised (Human approval required before run)';
}

function renderToolCard(v) {
  const el = document.createElement('div');
  el.className = 'tool ' + (v.installed && v.launchable !== false ? 'ok' : 'missing');
  const b = document.createElement('b');
  b.textContent = v.label;
  const s = document.createElement('small');
  s.textContent = v.installed ? (v.version || 'Found') + ' · ' + (v.capabilityMessage || v.executable || '') : 'Not detected';
  el.append(b, s);
  return el;
}

function renderDiscovery(d) {
  if (!d) return;
  discovery = d;
  const tools = d.tools || {};

  // Render in Settings diagnostics panel
  $('tools').replaceChildren(...Object.entries(tools).map(([, v]) => renderToolCard(v)));
  $('roots').textContent = 'Project folders: ' + ((d.projectSearchRoots || []).join(' · ') || 'No common project folders found');

  // Categorize for Onboarding step 2
  const required = ['node', 'git'].map(k => tools[k]).filter(Boolean);
  const agents = ['antigravity', 'opencode'].map(k => tools[k]).filter(Boolean);
  const optional = ['gh', 'obsidian', 'notion', 'npm', 'bash'].map(k => tools[k]).filter(Boolean);

  $('onboardRequiredTools').replaceChildren(...required.map(renderToolCard));
  $('onboardAgentTools').replaceChildren(...agents.map(renderToolCard));
  $('onboardOptionalTools').replaceChildren(...optional.map(renderToolCard));

  // Populate candidate repos
  const candidates = d.projectCandidates || [];
  const candidateOptions = [
    new Option(candidates.length ? 'Choose a discovered repository…' : 'No repositories found — browse manually', ''),
    ...candidates.map(x => new Option(x.name + ' — ' + x.path, x.path))
  ];
  $('candidates').replaceChildren(...candidateOptions);
  $('onboardRepoSelect').replaceChildren(...candidateOptions.map(o => new Option(o.text, o.value)));

  // Auto-select agent if detected and ready
  const available = ['antigravity', 'opencode'].filter(k => tools[k]?.installed && tools[k]?.launchable && tools[k]?.headlessReady);
  if ($('agent').value && !available.includes($('agent').value)) {
    $('agent').value = '';
    $('onboardAgentSelect').value = '';
  }
  if (available.length >= 1 && !$('agent').value) {
    const chosen = available[0];
    $('agent').value = chosen;
    $('onboardAgentSelect').value = chosen;
    $('exe').value = tools[chosen].executable || '';
    $('onboardAgentExe').value = tools[chosen].executable || '';
  }

  // Update status badge in header
  $('status').textContent = available.length
    ? `Ready · ${available.length === 1 ? tools[available[0]].label : 'Multiple agents'} detected`
    : 'Scan complete · no agent CLI validated yet';

  // Update integrations status with fresh discovery
  renderAllIntegrations(currentState?.settings);
}

function populateTeamStates(states, currentInProgressId, currentReviewId) {
  const stateNodes = states || [];
  for (const id of ['inProgress', 'onboardInProgress']) {
    const el = $(id);
    if (el) {
      el.replaceChildren(...stateNodes.map(s => new Option(`${s.name} (${s.type || 'state'})`, s.id)));
      let matched = currentInProgressId && stateNodes.some(s => s.id === currentInProgressId) ? currentInProgressId : '';
      if (!matched) {
        const match = stateNodes.find(s => s.type === 'started') || stateNodes.find(s => /progress/i.test(s.name));
        if (match) matched = match.id;
      }
      if (matched) el.value = matched;
    }
  }

  for (const id of ['review', 'onboardReview']) {
    const el = $(id);
    if (el) {
      el.replaceChildren(...stateNodes.map(s => new Option(`${s.name} (${s.type || 'state'})`, s.id)));
      let matched = currentReviewId && stateNodes.some(s => s.id === currentReviewId) ? currentReviewId : '';
      if (!matched) {
        const match = stateNodes.find(s => /review/i.test(s.name)) || stateNodes.find(s => s.type === 'unstarted');
        if (match) matched = match.id;
      }
      if (matched) el.value = matched;
    }
  }
}

function populateProjectsDropdown(projects, selectedProjectId) {
  const projectList = projects || [];
  const options = [
    new Option('All projects (No filter)', ''),
    ...projectList.map(p => new Option(p.name, p.id))
  ];

  for (const id of ['projectSelect', 'onboardProjectSelect']) {
    const el = $(id);
    if (el) {
      el.replaceChildren(...options.map(o => new Option(o.text, o.value)));
      if (selectedProjectId && projectList.some(p => p.id === selectedProjectId)) {
        el.value = selectedProjectId;
      } else {
        el.value = '';
      }
    }
  }
}

function populateTeams(teams, selectedTeamKey, selectedProjectId, inProgressId, reviewId) {
  cachedLinearTeams = teams || [];
  const teamOptions = [
    new Option(cachedLinearTeams.length ? 'Choose a team…' : 'No teams found in workspace', ''),
    ...cachedLinearTeams.map(t => new Option(`${t.name} (${t.key})`, t.key))
  ];

  for (const id of ['teamSelect', 'onboardTeamSelect']) {
    const el = $(id);
    if (el) {
      el.replaceChildren(...teamOptions.map(o => new Option(o.text, o.value)));
    }
  }

  let activeKey = selectedTeamKey;
  if (!activeKey && cachedLinearTeams.length > 0) {
    activeKey = cachedLinearTeams[0].key;
  }

  if (activeKey) {
    if ($('teamSelect')) $('teamSelect').value = activeKey;
    if ($('onboardTeamSelect')) $('onboardTeamSelect').value = activeKey;
    $('teamKey').value = activeKey;
    $('onboardTeamKey').value = activeKey;

    const selectedTeam = cachedLinearTeams.find(t => t.key === activeKey);
    if (selectedTeam) {
      populateTeamStates(selectedTeam.states, inProgressId, reviewId);
      populateProjectsDropdown(selectedTeam.projects, selectedProjectId);
    }
  }
}

function renderLinearStatus(settings, isWaiting = false, errorMsg = null) {
  if (!settings && !errorMsg && !isWaiting) return;
  const s = settings || currentState?.settings || {};
  const connected = Boolean(s.hasLinearConnected || s.hasLinearOAuth || s.hasLinearApiKey);
  const workspaceName = s.linearWorkspaceName || 'Linear Workspace';
  const userName = s.linearUserName || '';
  const userEmail = s.linearUserEmail || '';
  const userText = userName ? `Signed in as ${userName}${userEmail ? ` (${userEmail})` : ''}` : (userEmail ? `Signed in as ${userEmail}` : 'Connected to Linear');

  let pillText = 'Not connected';
  let pillClass = 'pill not-connected';
  if (isWaiting) {
    pillText = 'Connecting…';
    pillClass = 'pill connecting';
  } else if (errorMsg) {
    pillText = 'Connection failed';
    pillClass = 'pill error';
  } else if (connected) {
    pillText = 'Connected';
    pillClass = 'pill connected';
  }

  for (const id of ['linearStatus', 'onboardLinearStatusPill']) {
    if ($(id)) { $(id).textContent = pillText; $(id).className = pillClass; }
  }

  for (const prefix of ['onboardLinear', 'linear']) {
    $(`${prefix}Disconnected`)?.classList.toggle('hidden', isWaiting || connected || Boolean(errorMsg));
    $(`${prefix}Waiting`)?.classList.toggle('hidden', !isWaiting);
    $(`${prefix}Connected`)?.classList.toggle('hidden', isWaiting || !connected || Boolean(errorMsg));
    $(`${prefix}Error`)?.classList.toggle('hidden', !errorMsg);
    if (errorMsg && $(`${prefix}ErrorText`)) $(`${prefix}ErrorText`).textContent = errorMsg;
  }

  if (connected) {
    if ($('onboardWorkspaceName')) $('onboardWorkspaceName').textContent = workspaceName;
    if ($('settingsWorkspaceName')) $('settingsWorkspaceName').textContent = workspaceName;
    if ($('onboardConnectedUser')) $('onboardConnectedUser').textContent = userText;
    if ($('settingsConnectedUser')) $('settingsConnectedUser').textContent = userText;

    const teamsToUse = (Array.isArray(s.linearTeams) && s.linearTeams.length) ? s.linearTeams : cachedLinearTeams;
    if (Array.isArray(teamsToUse) && teamsToUse.length) {
      populateTeams(teamsToUse, s.linearTeamKey || teamsToUse[0]?.key, s.linearProjectId, s.inProgressStateId, s.reviewStateId);
    }
  }
}

function renderNotionStatus(settings, isWaiting = false, errorMsg = null) {
  const s = settings || currentState?.settings || {};
  const connected = Boolean(s.hasNotionConnected || s.notionConnected);
  const workspaceName = s.notionWorkspaceName || 'Notion Workspace';
  const botName = s.notionBotName ? `Bot: ${s.notionBotName}` : 'Integrated';

  let pillText = 'Not connected';
  let pillClass = 'pill not-connected';
  if (isWaiting) {
    pillText = 'Connecting…';
    pillClass = 'pill connecting';
  } else if (errorMsg) {
    pillText = 'Connection failed';
    pillClass = 'pill error';
  } else if (connected) {
    pillText = 'Connected';
    pillClass = 'pill connected';
  }

  for (const id of ['notionStatus', 'onboardNotionStatusPill']) {
    if ($(id)) { $(id).textContent = pillText; $(id).className = pillClass; }
  }

  for (const prefix of ['onboardNotion', 'notion']) {
    $(`${prefix}Disconnected`)?.classList.toggle('hidden', isWaiting || connected || Boolean(errorMsg));
    $(`${prefix}Waiting`)?.classList.toggle('hidden', !isWaiting);
    $(`${prefix}Connected`)?.classList.toggle('hidden', isWaiting || !connected || Boolean(errorMsg));
    $(`${prefix}Error`)?.classList.toggle('hidden', !errorMsg);
    if (errorMsg && $(`${prefix}ErrorText`)) $(`${prefix}ErrorText`).textContent = errorMsg;
  }

  if (connected) {
    if ($('onboardNotionWorkspaceName')) $('onboardNotionWorkspaceName').textContent = workspaceName;
    if ($('settingsNotionWorkspaceName')) $('settingsNotionWorkspaceName').textContent = workspaceName;
    if ($('onboardNotionBotName')) $('onboardNotionBotName').textContent = botName;
    if ($('settingsNotionBotName')) $('settingsNotionBotName').textContent = botName;
  }
}

function renderObsidianStatus(settings, isWaiting = false, errorMsg = null) {
  const s = settings || currentState?.settings || {};
  const connected = Boolean(s.hasObsidianConnected || s.obsidianConnected);
  const vaultName = s.obsidianVaultName || 'Obsidian Vault';
  const vaultPath = s.obsidianVaultPath || '';

  let pillText = 'Not connected';
  let pillClass = 'pill not-connected';
  if (isWaiting) {
    pillText = 'Connecting…';
    pillClass = 'pill connecting';
  } else if (errorMsg) {
    pillText = 'Connection failed';
    pillClass = 'pill error';
  } else if (connected) {
    pillText = 'Connected (Read-only)';
    pillClass = 'pill connected';
  }

  for (const id of ['obsidianStatus', 'onboardObsidianStatusPill']) {
    if ($(id)) { $(id).textContent = pillText; $(id).className = pillClass; }
  }

  for (const prefix of ['onboardObsidian', 'obsidian']) {
    $(`${prefix}Disconnected`)?.classList.toggle('hidden', isWaiting || connected || Boolean(errorMsg));
    $(`${prefix}Waiting`)?.classList.toggle('hidden', !isWaiting);
    $(`${prefix}Connected`)?.classList.toggle('hidden', isWaiting || !connected || Boolean(errorMsg));
    $(`${prefix}Error`)?.classList.toggle('hidden', !errorMsg);
    if (errorMsg && $(`${prefix}ErrorText`)) $(`${prefix}ErrorText`).textContent = errorMsg;
  }

  if (connected) {
    if ($('onboardObsidianVaultName')) $('onboardObsidianVaultName').textContent = vaultName;
    if ($('settingsObsidianVaultName')) $('settingsObsidianVaultName').textContent = vaultName;
    if ($('onboardObsidianVaultPath')) $('onboardObsidianVaultPath').textContent = vaultPath;
    if ($('settingsObsidianVaultPath')) $('settingsObsidianVaultPath').textContent = vaultPath;
  }

  // Populate discovered vaults in dropdowns
  const vaults = discovery?.tools?.obsidian?.vaults || [];
  for (const selId of ['onboardObsidianVaultSelect', 'obsidianVaultSelect']) {
    const sel = $(selId);
    if (sel && sel.children.length <= 1 && vaults.length) {
      sel.replaceChildren(
        new Option('Choose discovered vault…', ''),
        ...vaults.map(v => new Option(`${v.name} (${v.path})`, v.path))
      );
      if (vaultPath) sel.value = vaultPath;
    }
  }
}

function renderGithubStatus(settings, isWaiting = false, errorMsg = null) {
  const s = settings || currentState?.settings || {};
  const connected = Boolean(s.hasGithubConnected || s.githubConnected);
  const login = s.githubLogin ? `@${s.githubLogin}` : '@user';
  const name = s.githubName || '';

  let pillText = 'Not connected';
  let pillClass = 'pill not-connected';
  if (isWaiting) {
    pillText = 'Connecting…';
    pillClass = 'pill connecting';
  } else if (errorMsg) {
    pillText = 'Connection failed';
    pillClass = 'pill error';
  } else if (connected) {
    pillText = 'Connected';
    pillClass = 'pill connected';
  }

  for (const id of ['githubStatus', 'onboardGithubStatusPill']) {
    if ($(id)) { $(id).textContent = pillText; $(id).className = pillClass; }
  }

  for (const prefix of ['onboardGithub', 'github']) {
    $(`${prefix}Disconnected`)?.classList.toggle('hidden', isWaiting || connected || Boolean(errorMsg));
    $(`${prefix}Waiting`)?.classList.toggle('hidden', !isWaiting);
    $(`${prefix}Connected`)?.classList.toggle('hidden', isWaiting || !connected || Boolean(errorMsg));
    $(`${prefix}Error`)?.classList.toggle('hidden', !errorMsg);
    if (errorMsg && $(`${prefix}ErrorText`)) $(`${prefix}ErrorText`).textContent = errorMsg;
  }

  if (connected) {
    if ($('onboardGithubUserName')) $('onboardGithubUserName').textContent = login;
    if ($('settingsGithubUserName')) $('settingsGithubUserName').textContent = login;
    if ($('onboardGithubRealName')) $('onboardGithubRealName').textContent = name;
    if ($('settingsGithubRealName')) $('settingsGithubRealName').textContent = name;
  } else {
    const ghTool = discovery?.tools?.gh;
    const isGhAuth = ghTool?.installed && ghTool?.authenticated;
    for (const prefix of ['onboardGithub', 'github']) {
      const promptEl = $(`${prefix}CliPrompt`);
      const textEl = $(`${prefix}CliText`);
      if (promptEl) {
        promptEl.classList.toggle('hidden', !isGhAuth);
        if (isGhAuth && textEl) {
          textEl.textContent = `GitHub CLI detected on PC and authenticated. Click Connect to link instantly.`;
        }
      }
    }
  }
}

function renderAllIntegrations(settings) {
  renderLinearStatus(settings);
  renderNotionStatus(settings);
  renderObsidianStatus(settings);
  renderGithubStatus(settings);
}

function renderAutonomyDescription() {
  if ($('autonomyDescription')) $('autonomyDescription').textContent = AUTONOMY_DESCRIPTIONS[$('autonomyLevel').value] || '';
}

function renderPending(list) {
  const items = list || [];
  $('pendingCount').textContent = String(items.length);
  if (!items.length) {
    $('pendingList').replaceChildren(Object.assign(document.createElement('p'), {
      className: 'muted',
      textContent: 'Nothing is waiting. In Supervised mode, claimed tasks show up here before the agent runs; every tier also pauses once here before finalizing, unless you turn that off in Settings.'
    }));
    return;
  }
  $('pendingList').replaceChildren(...items.map(p => {
    const isReview = p.stage === 'review';
    const row = document.createElement('div');
    row.className = 'tool pending-row';
    const b = document.createElement('b');
    b.textContent = `${p.identifier} — ${p.title}${isReview ? ' (ready to finalize)' : ''}`;
    const s = document.createElement('small');
    s.textContent = isReview
      ? 'Implementation finished and passed verification. Approving will post the summary and move it to Review.'
      : (p.description ? p.description.slice(0, 160) : '(No description)');
    const actions = document.createElement('div');
    actions.className = 'actions';
    const approve = document.createElement('button');
    approve.textContent = isReview ? 'Approve & finalize' : 'Approve & run';
    approve.onclick = async () => {
      try {
        await window.orbit.approveTask(p.issueId);
        toast(`${p.identifier} approved.`);
        await refreshState();
      } catch (e) {
        toast(e.message);
      }
    };
    const reject = document.createElement('button');
    reject.className = 'danger';
    reject.textContent = isReview ? 'Hold' : 'Reject';
    reject.onclick = async () => {
      await window.orbit.rejectTask(p.issueId);
      toast(`${p.identifier} ${isReview ? 'held' : 'rejected'}.`);
      await refreshState();
    };
    actions.append(approve, reject);
    row.append(b, s, actions);
    return row;
  }));
}

function renderBlocked(history) {
  const seen = new Set();
  const blocked = [];
  for (const h of history || []) {
    if (!h.issueId || seen.has(h.issueId)) continue;
    seen.add(h.issueId);
    if (h.outcome === 'blocked') blocked.push(h);
  }
  $('blockedCount').textContent = String(blocked.length);
  if (!blocked.length) {
    $('blockedList').replaceChildren(Object.assign(document.createElement('p'), {
      className: 'muted',
      textContent: 'Nothing is blocked. A task lands here if verification kept failing after the retry budget, with its worktree preserved so you can Resume it.'
    }));
    return;
  }
  $('blockedList').replaceChildren(...blocked.map(h => {
    const row = document.createElement('div');
    row.className = 'tool pending-row';
    const b = document.createElement('b');
    b.textContent = `${h.identifier} — ${h.title}`;
    const s = document.createElement('small');
    s.textContent = (h.message || '').slice(0, 220);
    const note = document.createElement('input');
    note.placeholder = 'Optional note for the agent (what to try differently)';
    const actions = document.createElement('div');
    actions.className = 'actions';
    const resume = document.createElement('button');
    resume.textContent = 'Resume';
    resume.onclick = async () => {
      try {
        await window.orbit.resumeTask(h.issueId, note.value.trim());
        toast(`${h.identifier} resuming.`);
        await refreshState();
      } catch (e) {
        toast(e.message);
      }
    };
    const openFolder = document.createElement('button');
    openFolder.className = 'secondary';
    openFolder.textContent = 'Open worktree';
    openFolder.onclick = () => window.orbit.openPath(h.worktree);
    actions.append(resume, openFolder);
    row.append(b, s, note, actions);
    return row;
  }));
}

function applySettingsToForm(c) {
  if (!c) return;
  for (const [id, k] of [
    ['agent', 'agentId'],
    ['exe', 'agentExecutable'],
    ['projectName', 'projectName'],
    ['projectPath', 'projectPath'],
    ['baseBranch', 'baseBranch'],
    ['instructions', 'projectInstructions'],
    ['verifyCommand', 'verifyCommand'],
    ['teamKey', 'linearTeamKey'],
    ['ready', 'readyStateName'],
    ['clientId', 'linearOAuthClientId']
  ]) {
    if (c[k] !== undefined) $(id).value = c[k];
  }

  // Also sync to onboarding inputs
  if (c.agentId !== undefined) $('onboardAgentSelect').value = c.agentId;
  if (c.agentExecutable !== undefined) $('onboardAgentExe').value = c.agentExecutable;
  if (c.projectPath !== undefined) $('onboardProjectPath').value = c.projectPath;
  if (c.projectName !== undefined) $('onboardProjectName').value = c.projectName;
  if (c.linearTeamKey !== undefined) $('onboardTeamKey').value = c.linearTeamKey;
  if (c.readyStateName !== undefined) $('onboardReadyState').value = c.readyStateName;
  if (c.linearOAuthClientId !== undefined) $('onboardClientId').value = c.linearOAuthClientId;

  $('maxGateRetries').value = c.maxGateRetries ?? 2;
  $('auto').checked = c.autoRunEnabled !== false;
  $('startup').checked = !!c.startAtLogin;

  renderAllIntegrations(c);

  if (Array.isArray(c.linearTeams) && c.linearTeams.length) {
    populateTeams(c.linearTeams, c.linearTeamKey, c.linearProjectId, c.inProgressStateId, c.reviewStateId);
  }

  if (c.linearProjectId) {
    if ($('projectSelect')) $('projectSelect').value = c.linearProjectId;
    if ($('onboardProjectSelect')) $('onboardProjectSelect').value = c.linearProjectId;
  }

  const perm = c.permissions || {};
  $('autonomyLevel').value = perm.autonomyLevel || 'supervised';
  $('allowClaim').checked = perm.allowClaim !== false;
  $('allowAgentRun').checked = perm.allowAgentRun !== false;
  $('allowComment').checked = perm.allowComment !== false;
  $('allowReviewTransition').checked = perm.allowReviewTransition !== false;
  $('requireApprovalBeforeReview').checked = perm.requireApprovalBeforeReview !== false;
  $('onboardApprovalBeforeReview').checked = perm.requireApprovalBeforeReview !== false;

  $('allowPush').checked = !!perm.allowPush;
  $('onboardAllowPush').checked = !!perm.allowPush;
  $('allowPullRequest').checked = !!perm.allowPullRequest;
  $('onboardAllowPR').checked = !!perm.allowPullRequest;
  $('allowMerge').checked = !!perm.allowMerge;
  $('onboardAllowMerge').checked = !!perm.allowMerge;

  $('maxTasksPerDay').value = perm.maxTasksPerDay ?? 10;
  $('onboardMaxTasks').value = perm.maxTasksPerDay ?? 10;

  $('useActiveHours').checked = !!perm.activeHours?.enabled;
  $('activeStart').value = perm.activeHours?.start || '09:00';
  $('activeEnd').value = perm.activeHours?.end || '18:00';
  renderAutonomyDescription();

  const sched = c.schedule || {};
  $('scheduleEnabled').checked = !!sched.enabled;
  $('scheduleStart').value = sched.start || '09:00';
  $('scheduleEnd').value = sched.end || '18:00';
  $('scheduleWeekdays').checked = Array.isArray(sched.days) && sched.days.length === 5;
}

function gatherPayloadFromForms() {
  // Sync whichever was active or modified
  const agentId = $('onboardAgentSelect').value || $('agent').value;
  const agentExecutable = $('onboardAgentExe').value.trim() || $('exe').value.trim();
  const projectName = $('onboardProjectName').value.trim() || $('projectName').value.trim();
  const projectPath = $('onboardProjectPath').value.trim() || $('projectPath').value.trim();

  const linearTeamKey = $('onboardTeamSelect')?.value || $('teamSelect')?.value || $('onboardTeamKey').value.trim() || $('teamKey').value.trim() || cachedLinearTeams[0]?.key || '';
  const selectedTeam = cachedLinearTeams.find(t => t.key === linearTeamKey) || cachedLinearTeams[0];
  const linearTeamName = selectedTeam?.name || currentState?.settings?.linearTeamName || '';

  const linearProjectId = $('onboardProjectSelect')?.value || $('projectSelect')?.value || selectedTeam?.projects?.[0]?.id || '';
  let linearProjectName = '';
  if (linearProjectId && selectedTeam) {
    const proj = selectedTeam.projects?.find(x => x.id === linearProjectId);
    if (proj) linearProjectName = proj.name;
  } else if (!linearProjectId && currentState?.settings?.linearProjectName) {
    linearProjectName = '';
  }

  const readyStateName = $('onboardReadyState').value.trim() || $('ready').value.trim() || 'Ready for ORBIT';
  let inProgressStateId = $('onboardInProgress').value || $('inProgress').value;
  if (!inProgressStateId && selectedTeam) {
    const match = selectedTeam.states?.find(s => s.type === 'started') || selectedTeam.states?.find(s => /progress/i.test(s.name));
    if (match) inProgressStateId = match.id;
  }
  let reviewStateId = $('onboardReview').value || $('review').value;
  if (!reviewStateId && selectedTeam) {
    const match = selectedTeam.states?.find(s => /review/i.test(s.name));
    if (match) reviewStateId = match.id;
  }

  const linearAuthMode = currentState?.settings?.linearAuthMode || (currentState?.settings?.hasLinearOAuth ? 'oauth' : 'apiKey');
  const linearOAuthClientId = $('onboardClientId')?.value.trim() || $('clientId')?.value.trim() || '';

  const allowPush = currentView === 'onboarding' ? $('onboardAllowPush').checked : $('allowPush').checked;
  const allowPullRequest = currentView === 'onboarding' ? $('onboardAllowPR').checked : $('allowPullRequest').checked;
  const allowMerge = currentView === 'onboarding' ? $('onboardAllowMerge').checked : $('allowMerge').checked;
  const requireApprovalBeforeReview = currentView === 'onboarding' ? $('onboardApprovalBeforeReview').checked : $('requireApprovalBeforeReview').checked;
  const maxTasks = Number(currentView === 'onboarding' ? $('onboardMaxTasks').value : $('maxTasksPerDay').value) || 0;

  const perm = {
    autonomyLevel: currentView === 'onboarding' ? 'supervised' : $('autonomyLevel').value,
    allowClaim: $('allowClaim').checked,
    allowAgentRun: $('allowAgentRun').checked,
    allowComment: $('allowComment').checked,
    allowReviewTransition: $('allowReviewTransition').checked,
    requireApprovalBeforeReview,
    allowPush,
    allowPullRequest,
    allowMerge,
    maxTasksPerDay: maxTasks,
    activeHours: {
      enabled: $('useActiveHours').checked,
      start: $('activeStart').value.trim() || '09:00',
      end: $('activeEnd').value.trim() || '18:00'
    }
  };

  const schedule = {
    enabled: $('scheduleEnabled').checked,
    start: $('scheduleStart').value.trim() || '09:00',
    end: $('scheduleEnd').value.trim() || '18:00',
    days: $('scheduleWeekdays').checked ? [1, 2, 3, 4, 5] : []
  };

  const p = {
    agentId,
    agentExecutable,
    projectName,
    projectPath,
    baseBranch: $('baseBranch').value.trim() || 'HEAD',
    projectInstructions: $('instructions').value.trim(),
    verifyCommand: $('verifyCommand').value.trim(),
    maxGateRetries: Number($('maxGateRetries').value),
    linearTeamKey,
    linearTeamName,
    linearProjectId,
    linearProjectName,
    readyStateName,
    inProgressStateId,
    reviewStateId,
    autoRunEnabled: $('auto').checked,
    startAtLogin: $('startup').checked,
    linearAuthMode,
    linearOAuthClientId,
    linearTeams: cachedLinearTeams.length ? cachedLinearTeams : (currentState?.settings?.linearTeams || []),
    permissions: perm,
    schedule
  };

  const tokenVal = $('onboardLinearToken')?.value?.trim() || $('onboardToken')?.value?.trim() || $('token')?.value?.trim();
  if (tokenVal) p.linearToken = tokenVal;

  const secretVal = $('onboardClientSecret')?.value?.trim() || $('clientSecret')?.value?.trim();
  if (secretVal) p.linearOAuthClientSecret = secretVal;

  return p;
}

async function save() {
  const p = gatherPayloadFromForms();
  const state = await window.orbit.saveSettings(p);
  await window.orbit.setStartup(p.startAtLogin);
  if ($('token')) $('token').value = '';
  if ($('clientSecret')) $('clientSecret').value = '';
  if ($('onboardToken')) $('onboardToken').value = '';
  if ($('onboardLinearToken')) $('onboardLinearToken').value = '';
  if ($('onboardClientSecret')) $('onboardClientSecret').value = '';
  currentState = state;
  renderAllIntegrations(state.settings);
  renderPending(state.pending);
  renderBlocked(state.history);
  return state;
}

async function refreshState() {
  const s = await window.orbit.getState();
  currentState = s.state;
  applySettingsToForm(s.state.settings);
  renderPending(s.state.pending);
  renderBlocked(s.state.history);
  if ($('redirectUriHint')) $('redirectUriHint').textContent = s.redirectUri;
  if ($('onboardRedirectUriHint')) $('onboardRedirectUriHint').textContent = s.redirectUri;
  return s;
}

// Stepper navigation and event handlers
$('btnWelcomeStart').onclick = () => showOnboardingStep(2);

$('btnStep2Back').onclick = () => showOnboardingStep(1);
$('btnStep2Next').onclick = async () => {
  const agent = $('onboardAgentSelect').value;
  if (!agent) {
    toast('Please select a verified coding agent to proceed.');
    return;
  }
  const path = $('onboardProjectPath').value.trim();
  if (!path) {
    toast('Please select or enter a Git project repository path.');
    return;
  }
  // Sync to settings inputs
  $('agent').value = agent;
  $('exe').value = $('onboardAgentExe').value.trim();
  $('projectPath').value = path;
  $('projectName').value = $('onboardProjectName').value.trim();
  showOnboardingStep(3);
};

$('btnStep3Back').onclick = () => showOnboardingStep(2);
$('btnStep3Next').onclick = async () => {
  const team = $('onboardTeamSelect')?.value || $('onboardTeamKey').value.trim();
  if (team) {
    $('teamKey').value = team;
    $('onboardTeamKey').value = team;
  }
  $('ready').value = $('onboardReadyState').value.trim();
  if ($('onboardInProgress').value) $('inProgress').value = $('onboardInProgress').value;
  if ($('onboardReview').value) $('review').value = $('onboardReview').value;
  if ($('onboardProjectSelect')?.value) $('projectSelect').value = $('onboardProjectSelect').value;
  showOnboardingStep(4);
};

$('btnStep4Back').onclick = () => showOnboardingStep(3);
$('btnStep4Next').onclick = () => showOnboardingStep(5);

$('btnStep5Back').onclick = () => showOnboardingStep(4);

$('btnGoDashboard').onclick = async () => {
  try {
    const payload = gatherPayloadFromForms();
    await window.orbit.completeOnboarding({ ...payload, startWorker: false });
    toast('Setup complete. Welcome to ORBIT.');
    showView('dashboard');
    await refreshState();
  } catch (e) {
    toast(e.message);
  }
};

$('btnStartOrbit').onclick = async () => {
  try {
    const payload = gatherPayloadFromForms();
    toast('Starting ORBIT in the background…');
    await window.orbit.completeOnboarding({ ...payload, startWorker: true });
    $('workerState').textContent = 'Running';
    log('ORBIT worker started.');
    // Minimize to tray
    await window.orbit.hideWindow();
    showView('dashboard');
    await refreshState();
  } catch (e) {
    toast('Could not start worker: ' + e.message);
    log('ERROR: ' + e.message);
  }
};

// Stepper click handlers
for (let i = 1; i <= 5; i++) {
  const tab = $('stepTab' + i);
  if (tab) tab.onclick = () => showOnboardingStep(i);
}

// Header and View switching
$('navDashboard').onclick = () => showView('dashboard');
$('navSettings').onclick = () => showView('settings');
$('navMinimize').onclick = () => window.orbit.hideWindow();
$('btnMinimizeFromDash').onclick = () => window.orbit.hideWindow();
$('btnBackToDash').onclick = () => showView('dashboard');
$('btnScanFromDash').onclick = async () => {
  try {
    renderDiscovery(await window.orbit.discover());
    toast('Machine scan complete.');
    log('Machine scan complete.');
  } catch (e) {
    toast(e.message);
  }
};
$('btnRerunOnboarding').onclick = () => {
  showView('onboarding');
  showOnboardingStep(1);
};
$('btnSaveAllSettings').onclick = async () => {
  try {
    await save();
    toast('Settings saved successfully.');
    log('Settings updated.');
  } catch (e) {
    toast('Failed to save settings: ' + e.message);
  }
};

// Tool / Agent / Repo selectors
$('scan').onclick = async () => {
  try {
    renderDiscovery(await window.orbit.discover());
    log('Machine scan complete.');
    toast('Machine scan complete.');
  } catch (e) {
    toast(e.message);
  }
};

$('agent').onchange = () => {
  $('exe').value = discovery?.tools?.[$('agent').value]?.executable || '';
  $('onboardAgentSelect').value = $('agent').value;
  $('onboardAgentExe').value = $('exe').value;
};

$('onboardAgentSelect').onchange = () => {
  const val = $('onboardAgentSelect').value;
  $('onboardAgentExe').value = discovery?.tools?.[val]?.executable || '';
  $('agent').value = val;
  $('exe').value = $('onboardAgentExe').value;
};

$('candidates').onchange = () => {
  const x = discovery?.projectCandidates?.find(x => x.path === $('candidates').value);
  if (x) {
    $('projectPath').value = x.path;
    $('projectName').value = x.name;
    $('onboardProjectPath').value = x.path;
    $('onboardProjectName').value = x.name;
    $('onboardRepoSelect').value = x.path;
  }
};

$('onboardRepoSelect').onchange = () => {
  const x = discovery?.projectCandidates?.find(x => x.path === $('onboardRepoSelect').value);
  if (x) {
    $('onboardProjectPath').value = x.path;
    $('onboardProjectName').value = x.name;
    $('projectPath').value = x.path;
    $('projectName').value = x.name;
    $('candidates').value = x.path;
  }
};

$('browse').onclick = async () => {
  const p = await window.orbit.browseProject();
  if (p) {
    $('projectPath').value = p;
    $('onboardProjectPath').value = p;
    if (!$('projectName').value) {
      const name = p.split(/[\\/]/).filter(Boolean).pop();
      $('projectName').value = name;
      $('onboardProjectName').value = name;
    }
  }
};

$('onboardBrowseBtn').onclick = async () => {
  const p = await window.orbit.browseProject();
  if (p) {
    $('onboardProjectPath').value = p;
    $('projectPath').value = p;
    if (!$('onboardProjectName').value) {
      const name = p.split(/[\\/]/).filter(Boolean).pop();
      $('onboardProjectName').value = name;
      $('projectName').value = name;
    }
  }
};

// ==========================================
// 1. Linear Connection Handlers
// ==========================================
async function handleConnectLinearApiKey(source = 'onboard') {
  const inputId = source === 'onboard' ? 'onboardLinearToken' : 'token';
  const key = $(inputId)?.value?.trim();
  if (!key) {
    toast('Please paste your Linear Personal API key (starts with lin_api_).');
    $(inputId)?.focus();
    return;
  }
  try {
    renderLinearStatus(currentState?.settings, true);
    toast('Connecting to Linear…');
    log('Verifying Linear API key with Linear API…');
    const result = await window.orbit.connectLinearApiKey({ apiKey: key });
    currentState = result;
    if (result.workspaceContext?.teams?.length) {
      cachedLinearTeams = result.workspaceContext.teams;
      const initialTeamKey = result.settings?.linearTeamKey || cachedLinearTeams[0].key;
      const initialProjectId = result.settings?.linearProjectId || '';
      populateTeams(cachedLinearTeams, initialTeamKey, initialProjectId, result.settings?.inProgressStateId, result.settings?.reviewStateId);
    }
    renderLinearStatus(result.settings, false);
    toast(`Connected to ${result.settings.linearWorkspaceName || 'Linear'}!`);
    log(`Linear connected: ${result.settings.linearWorkspaceName}`);
    updateSummary();
    await save();
  } catch (e) {
    renderLinearStatus(currentState?.settings, false, e.message);
    toast('Linear connection failed: ' + e.message);
    log('ERROR: ' + e.message);
  }
}

async function handleConnectWithLinearOAuth(source = 'onboard') {
  const clientId = (source === 'onboard' ? $('onboardClientId')?.value : $('clientId')?.value)?.trim();
  const clientSecret = (source === 'onboard' ? $('onboardClientSecret')?.value : $('clientSecret')?.value)?.trim();

  if (!clientId) {
    const msg = 'Enter your Linear OAuth Client ID (from Linear Settings > API > Applications), or use your Personal API Key above for 1-click connection.';
    renderLinearStatus(currentState?.settings, false, msg);
    toast('Enter a Linear OAuth Client ID or use your Personal API Key above.');
    return;
  }

  try {
    isLinearWaiting = true;
    renderLinearStatus(currentState?.settings, true);
    toast('Opening default browser to authorize ORBIT with Linear…');
    log('Starting Linear OAuth PKCE S256 authorization flow…');

    const result = await window.orbit.oauthConnect({ clientId, clientSecret });
    isLinearWaiting = false;

    currentState = result;
    const teams = result.workspaceContext?.teams || result.settings?.linearTeams || [];
    if (teams.length) {
      cachedLinearTeams = teams;
      const initialTeamKey = result.settings?.linearTeamKey || cachedLinearTeams[0].key;
      const initialProjectId = result.settings?.linearProjectId || '';
      populateTeams(cachedLinearTeams, initialTeamKey, initialProjectId, result.settings?.inProgressStateId, result.settings?.reviewStateId);
    }

    renderLinearStatus(result.settings, false);
    toast(`Connected to ${result.settings.linearWorkspaceName || 'Linear'}!`);
    log(`Linear OAuth connected: ${result.settings.linearWorkspaceName || 'workspace'}`);
    updateSummary();
    await save();
  } catch (e) {
    isLinearWaiting = false;
    renderLinearStatus(currentState?.settings, false, e.message);
    if (/cancelled/i.test(e.message)) {
      toast('Authorization was cancelled.');
      log('Linear authorization cancelled.');
    } else {
      toast('Linear connection failed: ' + e.message);
      log('ERROR: ' + e.message);
    }
  }
}

async function handleCancelAuthorization() {
  try {
    await window.orbit.oauthCancel();
  } catch {}
  isLinearWaiting = false;
  renderLinearStatus(currentState?.settings, false);
  toast('Authorization cancelled.');
  log('Linear authorization cancelled by user.');
}

async function handleDisconnectLinear() {
  try {
    const state = await window.orbit.oauthDisconnect();
    currentState = state;
    cachedLinearTeams = [];
    isLinearWaiting = false;
    renderLinearStatus(state.settings, false);
    toast('Disconnected from Linear.');
    log('Disconnected from Linear.');
    updateSummary();
  } catch (e) {
    toast('Disconnect failed: ' + e.message);
  }
}

async function handleRefreshTeams() {
  try {
    toast('Refreshing Linear teams…');
    const ws = await window.orbit.fetchLinearContext();
    if (ws?.teams) {
      cachedLinearTeams = ws.teams;
      populateTeams(cachedLinearTeams, $('teamKey').value, currentState?.settings?.linearProjectId, currentState?.settings?.inProgressStateId, currentState?.settings?.reviewStateId);
      toast(`Refreshed ${ws.teams.length} Linear team(s).`);
      log(`Refreshed Linear teams: ${ws.teams.length} found.`);
      updateSummary();
    }
  } catch (e) {
    toast('Could not refresh teams: ' + e.message);
  }
}

function handleTeamSelectionChange(teamKey) {
  $('teamKey').value = teamKey;
  $('onboardTeamKey').value = teamKey;
  if ($('teamSelect')) $('teamSelect').value = teamKey;
  if ($('onboardTeamSelect')) $('onboardTeamSelect').value = teamKey;

  const team = cachedLinearTeams.find(t => t.key === teamKey);
  if (team) {
    populateTeamStates(team.states);
    populateProjectsDropdown(team.projects);
  }
  updateSummary();
}

function handleProjectSelectionChange(projectId) {
  if ($('projectSelect')) $('projectSelect').value = projectId;
  if ($('onboardProjectSelect')) $('onboardProjectSelect').value = projectId;
  updateSummary();
}

// ==========================================
// 2. Notion Connection Handlers
// ==========================================
async function handleConnectNotion(source = 'onboard') {
  const inputId = source === 'onboard' ? 'onboardNotionToken' : 'notionToken';
  const token = $(inputId)?.value?.trim();
  if (!token) {
    toast('Please paste your Notion integration token (starts with secret_).');
    $(inputId)?.focus();
    return;
  }
  try {
    renderNotionStatus(currentState?.settings, true);
    toast('Connecting to Notion…');
    log('Verifying Notion integration token…');
    const result = await window.orbit.notionConnect({ token });
    currentState = result;
    renderNotionStatus(result.settings, false);

    // Populate database and page selectors
    if (result.resources) {
      for (const prefix of ['onboardNotion', 'settingsNotion']) {
        const dbSel = $(`${prefix}DbSelect`);
        if (dbSel && result.resources.databases) {
          dbSel.replaceChildren(
            new Option('All authorized databases', ''),
            ...result.resources.databases.map(d => new Option(d.title, d.id))
          );
        }
        const pageSel = $(`${prefix}PageSelect`);
        if (pageSel && result.resources.pages) {
          pageSel.replaceChildren(
            new Option('All authorized pages', ''),
            ...result.resources.pages.map(p => new Option(p.title, p.id))
          );
        }
      }
    }

    toast(`Connected to Notion (${result.user?.workspaceName || 'Workspace'})!`);
    log(`Notion connected: ${result.user?.workspaceName}`);
    updateSummary();
    await save();
  } catch (e) {
    renderNotionStatus(currentState?.settings, false, e.message);
    toast('Notion connection failed: ' + e.message);
    log('ERROR: ' + e.message);
  }
}

async function handleDisconnectNotion() {
  try {
    const state = await window.orbit.notionDisconnect();
    currentState = state;
    renderNotionStatus(state.settings, false);
    toast('Disconnected from Notion.');
    log('Disconnected from Notion.');
    updateSummary();
  } catch (e) {
    toast('Disconnect failed: ' + e.message);
  }
}

// ==========================================
// 3. Obsidian Connection Handlers
// ==========================================
async function handleConnectObsidian(source = 'onboard') {
  const selId = source === 'onboard' ? 'onboardObsidianVaultSelect' : 'obsidianVaultSelect';
  const vaultPath = $(selId)?.value?.trim();
  if (!vaultPath) {
    toast('Please choose a vault or select a custom folder.');
    $(selId)?.focus();
    return;
  }
  try {
    renderObsidianStatus(currentState?.settings, true);
    toast('Connecting Obsidian vault…');
    const result = await window.orbit.obsidianConnect({ vaultPath });
    currentState = result;
    renderObsidianStatus(result.settings, false);
    toast(`Connected Obsidian vault: ${result.settings.obsidianVaultName}`);
    log(`Obsidian vault connected: ${result.settings.obsidianVaultName} (Read-only)`);
    updateSummary();
    await save();
  } catch (e) {
    renderObsidianStatus(currentState?.settings, false, e.message);
    toast('Obsidian connection failed: ' + e.message);
    log('ERROR: ' + e.message);
  }
}

async function handleBrowseObsidianVault(source = 'onboard') {
  const folder = await window.orbit.browseProject();
  if (folder) {
    const selId = source === 'onboard' ? 'onboardObsidianVaultSelect' : 'obsidianVaultSelect';
    const sel = $(selId);
    if (sel) {
      sel.appendChild(new Option(folder, folder, true, true));
      sel.value = folder;
    }
    await handleConnectObsidian(source);
  }
}

async function handleDisconnectObsidian() {
  try {
    const state = await window.orbit.obsidianDisconnect();
    currentState = state;
    renderObsidianStatus(state.settings, false);
    toast('Disconnected from Obsidian.');
    log('Disconnected from Obsidian.');
    updateSummary();
  } catch (e) {
    toast('Disconnect failed: ' + e.message);
  }
}

// ==========================================
// 4. GitHub Connection Handlers
// ==========================================
async function handleConnectGithub(source = 'onboard') {
  const inputId = source === 'onboard' ? 'onboardGithubToken' : 'githubToken';
  const token = $(inputId)?.value?.trim();
  try {
    renderGithubStatus(currentState?.settings, true);
    toast('Connecting to GitHub…');
    log('Verifying GitHub authentication…');
    const result = await window.orbit.githubConnect({ token });
    currentState = result;
    renderGithubStatus(result.settings, false);

    // Populate repos
    if (Array.isArray(result.repos)) {
      for (const prefix of ['onboardGithub', 'settingsGithub']) {
        const repoSel = $(`${prefix}RepoSelect`);
        if (repoSel) {
          repoSel.replaceChildren(
            new Option('Select scoped repository…', ''),
            ...result.repos.map(r => new Option(`${r.fullName} (${r.private ? 'Private' : 'Public'})`, r.fullName))
          );
        }
      }
    }

    toast(`Connected to GitHub as @${result.user?.login}!`);
    log(`GitHub connected: @${result.user?.login}`);
    updateSummary();
    await save();
  } catch (e) {
    renderGithubStatus(currentState?.settings, false, e.message);
    toast('GitHub connection failed: ' + e.message);
    log('ERROR: ' + e.message);
  }
}

async function handleDisconnectGithub() {
  try {
    const state = await window.orbit.githubDisconnect();
    currentState = state;
    renderGithubStatus(state.settings, false);
    toast('Disconnected from GitHub.');
    log('Disconnected from GitHub.');
    updateSummary();
  } catch (e) {
    toast('Disconnect failed: ' + e.message);
  }
}

// Wire Connect & Disconnect Buttons
// Linear
$('onboardLinearConnectBtn').onclick = () => handleConnectLinearApiKey('onboard');
$('linearConnectBtn').onclick = () => handleConnectLinearApiKey('settings');
$('onboardLinearOAuthBtn').onclick = () => handleConnectWithLinearOAuth('onboard');
$('linearOAuthBtn').onclick = () => handleConnectWithLinearOAuth('settings');
$('onboardLinearCancelBtn').onclick = handleCancelAuthorization;
$('linearCancelBtn').onclick = handleCancelAuthorization;
$('onboardLinearDisconnectBtn').onclick = handleDisconnectLinear;
$('linearDisconnectBtn').onclick = handleDisconnectLinear;
$('onboardLinearRetryBtn').onclick = () => renderLinearStatus(currentState?.settings, false);
$('linearRetryBtn').onclick = () => renderLinearStatus(currentState?.settings, false);
$('onboardRefreshTeamsBtn').onclick = handleRefreshTeams;
$('refreshTeamsBtn').onclick = handleRefreshTeams;

// Notion
$('onboardNotionConnectBtn').onclick = () => handleConnectNotion('onboard');
$('notionConnectBtn').onclick = () => handleConnectNotion('settings');
$('onboardNotionDisconnectBtn').onclick = handleDisconnectNotion;
$('notionDisconnectBtn').onclick = handleDisconnectNotion;
$('onboardNotionRetryBtn').onclick = () => renderNotionStatus(currentState?.settings, false);
$('notionRetryBtn').onclick = () => renderNotionStatus(currentState?.settings, false);

// Obsidian
$('onboardObsidianConnectBtn').onclick = () => handleConnectObsidian('onboard');
$('obsidianConnectBtn').onclick = () => handleConnectObsidian('settings');
$('onboardObsidianBrowseBtn').onclick = () => handleBrowseObsidianVault('onboard');
$('obsidianBrowseBtn').onclick = () => handleBrowseObsidianVault('settings');
$('onboardObsidianDisconnectBtn').onclick = handleDisconnectObsidian;
$('obsidianDisconnectBtn').onclick = handleDisconnectObsidian;
$('onboardObsidianRetryBtn').onclick = () => renderObsidianStatus(currentState?.settings, false);
$('obsidianRetryBtn').onclick = () => renderObsidianStatus(currentState?.settings, false);

// GitHub
$('onboardGithubConnectBtn').onclick = () => handleConnectGithub('onboard');
$('githubConnectBtn').onclick = () => handleConnectGithub('settings');
$('onboardGithubDisconnectBtn').onclick = handleDisconnectGithub;
$('githubDisconnectBtn').onclick = handleDisconnectGithub;
$('onboardGithubRetryBtn').onclick = () => renderGithubStatus(currentState?.settings, false);
$('githubRetryBtn').onclick = () => renderGithubStatus(currentState?.settings, false);

// Select events
$('onboardTeamSelect').onchange = () => handleTeamSelectionChange($('onboardTeamSelect').value);
$('teamSelect').onchange = () => handleTeamSelectionChange($('teamSelect').value);
$('onboardProjectSelect').onchange = () => handleProjectSelectionChange($('onboardProjectSelect').value);
$('projectSelect').onchange = () => handleProjectSelectionChange($('projectSelect').value);

$('autonomyLevel').onchange = renderAutonomyDescription;

// Dashboard controls
$('start').onclick = async () => {
  try {
    await save();
    await window.orbit.start();
    $('workerState').textContent = 'Running';
    toast('ORBIT worker started.');
    log('Worker started.');
  } catch (e) {
    toast(e.message);
  }
};

$('stop').onclick = async () => {
  await window.orbit.stop();
  $('workerState').textContent = 'Stopped';
  log('Worker stopped.');
};

$('pause').onclick = async () => {
  const v = $('pause').textContent === 'Pause queue';
  await window.orbit.pause(v);
  $('pause').textContent = v ? 'Resume queue' : 'Pause queue';
  $('workerState').textContent = v ? 'Paused' : 'Running';
};

// Event stream & Navigation
window.orbit.onEvent(e => {
  if (e.type === 'discovery' && e.result) renderDiscovery(e.result);
  if (e.type === 'worker') {
    $('workerState').textContent = e.state;
    if (e.state === 'Paused') $('pause').textContent = 'Resume queue';
    if (e.state === 'Running') $('pause').textContent = 'Pause queue';
  }
  if (e.type === 'task') {
    $('activeTask').textContent = e.issue ? e.issue.identifier + ' · ' + e.issue.title : 'No active task';
    log((e.issue?.identifier || 'Task') + ': ' + e.state);
    if (['completed', 'failed', 'blocked'].includes(e.state)) $('activeTask').textContent = 'No active task';
  }
  if (e.type === 'pending') {
    log(`${e.issue.identifier} is waiting for approval${e.stage === 'review' ? ' (ready to finalize)' : ''}.`);
    refreshState();
  }
  if (e.type === 'deferred') log(`Deferred ${e.issue} (${e.reason}).`);
  if (e.type === 'schedule') {
    log(`Schedule: ${e.state}.`);
    if (['auto-started', 'auto-stopped', 'auto-stopped-after-task'].includes(e.state)) {
      $('workerState').textContent = e.state === 'auto-started' ? 'Running' : 'Stopped';
    }
  }
  if (e.type === 'error') {
    log('ERROR: ' + e.message);
    toast(e.message);
  }
  if (e.type === 'agent-output' && e.text) log(e.issue + ' ' + e.stream + ': ' + e.text.trim().slice(-180));
  if (['completed', 'blocked', 'failed', 'held'].includes(e.type === 'task' ? e.state : '')) refreshState();
});

window.orbit.onNavigate(targetView => {
  if (targetView === 'settings') showView('settings');
  else if (targetView === 'dashboard') showView('dashboard');
});

// Initialization
(async () => {
  try {
    const s = await window.orbit.getState();
    currentState = s.state;
    applySettingsToForm(s.state.settings);
    renderPending(s.state.pending);
    renderBlocked(s.state.history);
    renderDiscovery(s.discovery);
    if ($('redirectUriHint')) $('redirectUriHint').textContent = s.redirectUri;
    if ($('onboardRedirectUriHint')) $('onboardRedirectUriHint').textContent = s.redirectUri;

    if (s.state.settings?.onboardingComplete) {
      showView('dashboard');
      log('ORBIT initialized in background mode.');
    } else {
      showView('onboarding');
      showOnboardingStep(1);
    }
  } catch (e) {
    toast(e.message);
  }
})();
