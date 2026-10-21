// ORBIT Desktop v0.7.0 Modern Renderer Logic
let currentData = null;
let awaitingTaskId = null;
let runStartTime = null;
let runTimerInterval = null;

// Helper: Escape HTML
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Toast Notification
function showToast(msg) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 2500);
}

// Navigation Tab Switching
function switchTab(targetTab) {
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  
  const tabBtn = document.querySelector(`.nav-tab[data-tab="${targetTab}"]`);
  if (tabBtn) tabBtn.classList.add('active');
  
  const pane = document.getElementById('pane' + targetTab.charAt(0).toUpperCase() + targetTab.slice(1));
  if (pane) pane.classList.add('active');
}

document.querySelectorAll('.nav-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const target = tab.getAttribute('data-tab');
    switchTab(target);
  });
});

// Terminal Console Logger
function appendLog(line, type = 'info') {
  const box = document.getElementById('consoleBox');
  if (!box) return;
  const time = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  box.textContent += `\n[${time}] ${line}`;
  box.scrollTop = box.scrollHeight;
}

// Update Elapsed Timer
function startElapsedTimer() {
  stopElapsedTimer();
  runStartTime = Date.now();
  const el = document.getElementById('activeElapsedTimer');
  runTimerInterval = setInterval(() => {
    if (!runStartTime || !el) return;
    const diff = Math.floor((Date.now() - runStartTime) / 1000);
    const m = String(Math.floor(diff / 60)).padStart(2, '0');
    const s = String(diff % 60).padStart(2, '0');
    el.textContent = `${m}:${s}`;
  }, 1000);
}

function stopElapsedTimer() {
  if (runTimerInterval) clearInterval(runTimerInterval);
  runTimerInterval = null;
  runStartTime = null;
}

// Render Engine Guidance Banner (orbit next)
function renderGuidance(nextAction) {
  const summaryEl = document.getElementById('guidanceSummary');
  const detailEl = document.getElementById('guidanceDetail');
  const actionBtn = document.getElementById('btnGuidanceAction');
  if (!summaryEl || !detailEl || !actionBtn) return;

  const lines = Array.isArray(nextAction) ? nextAction.filter(Boolean) : [String(nextAction || '')];
  if (!lines.length) {
    summaryEl.textContent = 'Ready to execute plan.';
    detailEl.textContent = 'Click "Run Plan" to execute tasks unattended in an isolated git worktree.';
    actionBtn.textContent = '▶ Run Plan';
    actionBtn.onclick = () => document.getElementById('btnRunPlan').click();
    return;
  }

  summaryEl.textContent = lines[0];
  detailEl.textContent = lines.slice(1).join(' · ') || 'Follow recommendation above.';

  if (/setup/i.test(lines[0]) || /no plan/i.test(lines[0])) {
    actionBtn.textContent = '⚡ Open Setup';
    actionBtn.onclick = () => switchTab('setup');
  } else if (/review/i.test(lines[0]) || /waiting/i.test(lines[0])) {
    actionBtn.textContent = '✓ Review Task';
    actionBtn.onclick = () => switchTab('plan');
  } else if (/done/i.test(lines[0])) {
    actionBtn.textContent = '📊 View Report';
    actionBtn.onclick = () => switchTab('report');
  } else {
    actionBtn.textContent = '▶ Run Plan';
    actionBtn.onclick = () => document.getElementById('btnRunPlan').click();
  }
}

// Render Tasks List
function renderTasks(plan, state) {
  const list = document.getElementById('taskList');
  if (!list) return;

  if (!plan || !plan.tasks || plan.tasks.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <svg class="ui-icon" width="32" height="32" style="color: var(--text-dim)"><use href="#icon-plan"/></svg>
        <p style="font-size: 13px; font-weight: 600; color: var(--text-muted); margin-bottom: 4px;">No tasks found in PLAN.md</p>
        <p style="font-size: 11.5px; color: var(--text-dim); margin-bottom: 12px;">Start by running the Guided Setup or adding your first task.</p>
        <div style="display: flex; gap: 8px;">
          <button id="btnEmptySetup" class="btn btn-primary btn-sm">⚡ Guided Setup</button>
          <button id="btnEmptyAdd" class="btn btn-secondary btn-sm">+ Add Task</button>
        </div>
      </div>
    `;
    document.getElementById('btnEmptySetup')?.addEventListener('click', () => switchTab('setup'));
    document.getElementById('btnEmptyAdd')?.addEventListener('click', () => document.getElementById('btnOpenAddTask').click());
    updateProgress(0, 0);
    return;
  }

  const tasks = plan.tasks;
  const completed = tasks.filter(t => t.done).length;
  updateProgress(completed, tasks.length);

  list.innerHTML = tasks.map(t => {
    const s = state?.tasks?.[t.id];
    let statusClass = 'pending';
    let statusLabel = 'PENDING';

    if (t.done || s?.status === 'done') {
      statusClass = 'done';
      statusLabel = 'DONE';
    } else if (s?.status === 'running') {
      statusClass = 'running';
      statusLabel = 'RUNNING';
    } else if (s?.status === 'awaiting-approval') {
      statusClass = 'awaiting';
      statusLabel = 'NEEDS REVIEW';
    } else if (s?.status === 'blocked') {
      statusClass = 'danger';
      statusLabel = 'BLOCKED';
    }

    const attemptsInfo = s?.attempts && s.attempts > 1 ? ` · attempt ${s.attempts}` : '';

    return `
      <div class="task-item ${statusClass}" data-id="${escapeHtml(t.id)}">
        <input type="checkbox" class="task-checkbox" ${t.done ? 'checked disabled' : ''}>
        <div class="task-content">
          <div class="task-title-row">
            <span class="task-title">${escapeHtml(t.title)}</span>
            <div style="display: flex; gap: 6px; align-items: center;">
              <span class="task-id">${escapeHtml(t.id)}</span>
              <span class="badge-tag ${statusClass}">${statusLabel}${attemptsInfo}</span>
            </div>
          </div>
          ${t.details ? `<div class="task-desc">${escapeHtml(t.details)}</div>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function updateProgress(done, total) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const fill = document.getElementById('progressBarFill');
  const txt = document.getElementById('progressText');
  const stats = document.getElementById('planStats');
  if (fill) fill.style.width = pct + '%';
  if (txt) txt.textContent = `${done} of ${total} completed (${pct}%)`;
  if (stats) stats.textContent = `${total} tasks`;
}

// Render Policy Agents Grid
function renderAgents(containerId, adapters, selectedAgent) {
  const grid = document.getElementById(containerId);
  if (!grid || !adapters) return;

  grid.innerHTML = adapters.map(a => {
    const isSelected = a.id === selectedAgent;
    const isInstalled = Boolean(a.path);
    return `
      <div class="agent-card ${isSelected ? 'selected' : ''}" data-agent="${escapeHtml(a.id)}">
        <div class="agent-card-header">
          <span class="agent-name">${escapeHtml(a.label)}</span>
          <span class="agent-status-tag ${isInstalled ? 'ok' : 'no'}">
            ${isInstalled ? 'Installed' : 'Missing'}
          </span>
        </div>
        <div class="agent-hint">${escapeHtml(a.hint)}</div>
      </div>
    `;
  }).join('');

  grid.querySelectorAll('.agent-card').forEach(card => {
    card.addEventListener('click', () => {
      grid.querySelectorAll('.agent-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
    });
  });
}

// Render Canary Tests Grid
function renderCanaryGrid(adapters) {
  const grid = document.getElementById('canaryGrid');
  if (!grid || !adapters) return;

  grid.innerHTML = adapters.map(a => {
    const isInstalled = Boolean(a.path);
    return `
      <div class="canary-card">
        <div class="canary-card-header">
          <span class="canary-card-title">${escapeHtml(a.label)}</span>
          <span class="agent-status-tag ${isInstalled ? 'ok' : 'no'}">
            ${isInstalled ? 'PATH OK' : 'Not on PATH'}
          </span>
        </div>
        <div class="canary-meta">
          <div><b>ID:</b> <code>${escapeHtml(a.id)}</code></div>
          <div><b>Hint:</b> ${escapeHtml(a.hint)}</div>
        </div>
        <button class="btn btn-secondary btn-sm btn-run-canary" data-agent="${escapeHtml(a.id)}" ${isInstalled ? '' : 'disabled'}>
          <svg class="ui-icon" width="13" height="13"><use href="#icon-canary"/></svg>
          <span>Run Canary Test</span>
        </button>
      </div>
    `;
  }).join('');

  grid.querySelectorAll('.btn-run-canary').forEach(btn => {
    btn.addEventListener('click', async () => {
      const agentId = btn.getAttribute('data-agent');
      const consoleCard = document.getElementById('canaryConsoleCard');
      const consoleBox = document.getElementById('canaryConsoleBox');
      const consoleTitle = document.getElementById('canaryConsoleTitle');
      
      if (consoleCard) consoleCard.style.display = 'block';
      if (consoleTitle) consoleTitle.textContent = `Canary Test: ${agentId}`;
      if (consoleBox) consoleBox.textContent = `[canary] Launching sandbox test for ${agentId}…\n`;

      btn.disabled = true;
      btn.textContent = 'Testing…';

      try {
        const res = await window.orbit.testAdapter(agentId);
        if (consoleBox) {
          consoleBox.textContent += `Status: ${res.ok ? 'PASSED' : 'FAILED'}\n`;
          if (res.output) consoleBox.textContent += `Output:\n${res.output}\n`;
          if (res.error) consoleBox.textContent += `Error:\n${res.error}\n`;
        }
        showToast(res.ok ? `Canary test passed for ${agentId}!` : `Canary test failed for ${agentId}`);
      } catch (err) {
        if (consoleBox) consoleBox.textContent += `Fatal Error: ${err.message}\n`;
        showToast(`Canary error: ${err.message}`);
      } finally {
        btn.disabled = false;
        btn.innerHTML = `<svg class="ui-icon" width="13" height="13"><use href="#icon-canary"/></svg><span>Run Canary Test</span>`;
      }
    });
  });
}

// Render Doctor Checks
function renderDoctor(doctor, adapters) {
  const grid = document.getElementById('doctorGrid');
  if (!grid || !doctor) return;

  const items = [
    { title: 'Node.js Runtime', ok: doctor.nodeOk, detail: `v${process.versions.node} (SEA supported)` },
    { title: 'Git Environment', ok: doctor.gitOk, detail: doctor.gitVersion || 'Git installed' },
    { title: 'Git Repository', ok: doctor.isGitRepo, detail: doctor.isGitRepo ? 'Repository detected' : 'Not a git repo' },
    { title: 'PLAN.md Validity', ok: doctor.planOk, detail: `${doctor.planTaskCount || 0} tasks defined` },
    { title: 'Policy Verification', ok: doctor.policyOk, detail: doctor.policyOk ? 'Verification command set' : 'Missing verify command' },
    { title: 'Default Agent CLI', ok: doctor.agentOk, detail: doctor.agentOk ? 'Found on system PATH' : 'Not found on PATH' }
  ];

  grid.innerHTML = items.map(i => `
    <div class="doctor-card">
      <div class="doctor-icon-box ${i.ok ? 'ok' : 'bad'}">
        <svg class="ui-icon" width="14" height="14"><use href="#icon-${i.ok ? 'check' : 'x'}"/></svg>
      </div>
      <div class="doctor-meta">
        <span class="doctor-title">${escapeHtml(i.title)}</span>
        <span class="doctor-detail">${escapeHtml(i.detail)}</span>
      </div>
    </div>
  `).join('');
}

// Main UI Refresh
function refreshUI(data) {
  if (!data) return;
  currentData = data;

  // Project Header details
  const parts = (data.dir || '').split(/[\\/]/);
  const dirName = parts[parts.length - 1] || data.dir;
  document.getElementById('currentProjectName').textContent = dirName;
  document.getElementById('currentProjectPath').textContent = data.dir;
  document.getElementById('branchText').textContent = data.gitBranch || 'main';
  document.getElementById('activeBranchText').textContent = data.gitBranch || 'main';

  // Setup Wizard Step 1 values
  document.getElementById('setupGitBranchVal').textContent = data.gitBranch || 'main';
  document.getElementById('setupGitRepoVal').textContent = data.doctor?.isGitRepo ? 'Detected' : 'Not a Git Repo';

  // Active Runner Card Details
  const pol = data.policy || {};
  document.getElementById('activeAgentName').textContent = pol.agent || 'claude-code';
  document.getElementById('activeVerifyCmd').textContent = pol.verify || 'none';

  // Engine Guidance Banner
  renderGuidance(data.nextAction);

  // Tasks
  renderTasks(data.plan, data.state);

  // Policy view
  renderAgents('policyAgentGrid', data.adapters, pol.agent);
  document.getElementById('inputVerify').value = pol.verify || data.suggestedVerify || 'npm test';
  document.getElementById('selectApproval').value = pol.approval || 'none';
  document.getElementById('guardPush').checked = pol.rules?.['git.push'] !== 'allow';
  document.getElementById('guardMerge').checked = pol.rules?.['git.merge'] !== 'allow';
  document.getElementById('guardPr').checked = pol.rules?.['pr.create'] !== 'allow';
  if (pol.limits) {
    document.getElementById('limitMaxAttempts').value = pol.limits.maxAttempts || 3;
    document.getElementById('limitTaskTimeout').value = pol.limits.taskTimeoutMin || 30;
    document.getElementById('limitStall').value = pol.limits.stallMin || 10;
  }

  // Setup Wizard view
  renderAgents('setupAgentGrid', data.adapters, pol.agent || 'claude-code');
  document.getElementById('setupVerifyInput').value = data.suggestedVerify || pol.verify || 'npm test';
  document.getElementById('setupVerifyHint').textContent = `Suggested from project files: ${data.suggestedVerify || 'npm test'}`;

  // Canary view
  renderCanaryGrid(data.adapters);

  // Doctor view
  renderDoctor(data.doctor, data.adapters);

  // Report view
  const reportBox = document.getElementById('reportBox');
  if (reportBox) {
    reportBox.textContent = data.report || 'No report generated yet. Run your plan to generate .orbit/report.md';
  }

  // Pending approval check
  checkPendingApproval(data.state);
}

function checkPendingApproval(state) {
  const card = document.getElementById('approvalCard');
  if (!state || !state.tasks) {
    card.style.display = 'none';
    return;
  }
  const pending = Object.entries(state.tasks).find(([_id, t]) => t.status === 'awaiting-approval');
  if (pending) {
    awaitingTaskId = pending[0];
    const t = pending[1];
    document.getElementById('approvalTitle').textContent = `Task ${awaitingTaskId} requires approval`;
    document.getElementById('approvalDesc').textContent = `Verification passed for "${t.title || awaitingTaskId}". Review the work before committing.`;
    
    const diffStat = document.getElementById('approvalDiffStat');
    if (diffStat) {
      diffStat.textContent = t.commit ? `Commit ${t.commit.slice(0, 8)} · Branch ${state.branch || 'orbit/work'}` : 'Verification exited 0';
    }

    card.style.display = 'flex';
    document.getElementById('statusPill').className = 'status-indicator-pill needs-action';
    document.getElementById('statusText').textContent = 'Action Required';
  } else {
    awaitingTaskId = null;
    card.style.display = 'none';
  }
}

// Project Directory Picker
document.getElementById('projectPicker')?.addEventListener('click', async () => {
  const updated = await window.orbit.selectProjectDir();
  if (updated) refreshUI(updated);
});

// Add Task Modal Controls
document.getElementById('btnOpenAddTask')?.addEventListener('click', () => {
  document.getElementById('addTaskModal').classList.add('open');
  document.getElementById('modalTaskTitle').focus();
});

document.getElementById('btnCancelAddTask')?.addEventListener('click', () => {
  document.getElementById('addTaskModal').classList.remove('open');
});
document.getElementById('btnCancelAddTask2')?.addEventListener('click', () => {
  document.getElementById('addTaskModal').classList.remove('open');
});

document.getElementById('btnSubmitAddTask')?.addEventListener('click', async () => {
  const title = document.getElementById('modalTaskTitle').value.trim();
  const details = document.getElementById('modalTaskDetails').value.trim();
  if (!title) return;
  currentData = await window.orbit.addTask({ title, details });
  document.getElementById('addTaskModal').classList.remove('open');
  document.getElementById('modalTaskTitle').value = '';
  document.getElementById('modalTaskDetails').value = '';
  refreshUI(currentData);
  showToast('Task added to PLAN.md');
});

// Setup Wizard Form Actions
document.getElementById('btnApplySuggestedVerify')?.addEventListener('click', () => {
  if (currentData?.suggestedVerify) {
    document.getElementById('setupVerifyInput').value = currentData.suggestedVerify;
    showToast(`Applied ${currentData.suggestedVerify}`);
  }
});

document.querySelectorAll('.radio-card').forEach(rc => {
  rc.addEventListener('click', () => {
    document.querySelectorAll('.radio-card').forEach(c => c.classList.remove('selected'));
    rc.classList.add('selected');
  });
});

document.getElementById('btnSaveSetup')?.addEventListener('click', async () => {
  const selectedAgentCard = document.querySelector('#setupAgentGrid .agent-card.selected');
  const agent = selectedAgentCard ? selectedAgentCard.getAttribute('data-agent') : 'claude-code';
  const verify = document.getElementById('setupVerifyInput').value.trim() || 'npm test';
  const approval = document.querySelector('.radio-card.selected')?.getAttribute('data-approval') || 'none';
  const firstTask = document.getElementById('setupFirstTaskInput').value.trim();

  try {
    currentData = await window.orbit.runSetup({ agent, verify, approval, firstTask });
    refreshUI(currentData);
    showToast('Project initialized! Opening Plan view.');
    switchTab('plan');
  } catch (err) {
    showToast(`Setup error: ${err.message}`);
  }
});

// Policy Form Save
document.getElementById('btnSavePolicy')?.addEventListener('click', async () => {
  const selectedAgentCard = document.querySelector('#policyAgentGrid .agent-card.selected');
  const agent = selectedAgentCard ? selectedAgentCard.getAttribute('data-agent') : 'claude-code';
  const verify = document.getElementById('inputVerify').value.trim();
  const approval = document.getElementById('selectApproval').value;

  const maxAttempts = parseInt(document.getElementById('limitMaxAttempts').value, 10) || 3;
  const taskTimeoutMin = parseInt(document.getElementById('limitTaskTimeout').value, 10) || 30;
  const stallMin = parseInt(document.getElementById('limitStall').value, 10) || 10;

  const rules = {
    'git.push': document.getElementById('guardPush').checked ? 'block' : 'allow',
    'git.merge': document.getElementById('guardMerge').checked ? 'block' : 'allow',
    'pr.create': document.getElementById('guardPr').checked ? 'block' : 'allow'
  };

  const newPolicy = {
    agent,
    agentArgs: currentData?.policy?.agentArgs || [],
    verify: verify || null,
    approval,
    limits: { maxAttempts, taskTimeoutMin, stallMin, maxTasks: 0, maxRuntimeMin: 0 },
    rules
  };

  currentData = await window.orbit.savePolicy(newPolicy);
  refreshUI(currentData);
  showToast('Policy & guardrails saved successfully');
});

// Runner Actions
document.getElementById('btnDryRun')?.addEventListener('click', async () => {
  appendLog('Executing dry run to inspect next task prompt and git state…');
  try {
    const res = await window.orbit.dryRun();
    if (res.prompt) {
      appendLog(`[dry-run] Prompt for ${res.task.id}:\n${res.prompt}`);
    } else {
      appendLog(`[dry-run] ${res.status || 'No tasks ready.'}`);
    }
  } catch (err) {
    appendLog(`[dry-run error] ${err.message}`);
  }
});

document.getElementById('btnRunPlan')?.addEventListener('click', async () => {
  try {
    await window.orbit.runPlan();
    document.getElementById('btnRunPlan').style.display = 'none';
    document.getElementById('btnStopPlan').style.display = 'inline-flex';
    document.getElementById('activeRunSpinner').style.display = 'inline-block';
    document.getElementById('statusPill').className = 'status-indicator-pill running';
    document.getElementById('statusText').textContent = 'Running Plan';
    startElapsedTimer();
    appendLog('Plan execution started unattended.');
  } catch (err) {
    appendLog(`[error] Could not start run: ${err.message}`);
    showToast(`Error: ${err.message}`);
  }
});

document.getElementById('btnStopPlan')?.addEventListener('click', async () => {
  await window.orbit.stopPlan();
  document.getElementById('btnStopPlan').style.display = 'none';
  document.getElementById('btnRunPlan').style.display = 'inline-flex';
  document.getElementById('activeRunSpinner').style.display = 'none';
  document.getElementById('statusPill').className = 'status-indicator-pill ready';
  document.getElementById('statusText').textContent = 'Stopped';
  stopElapsedTimer();
  appendLog('Execution stopped by user.');
});

// Approval & Rejection
document.getElementById('btnApproveTask')?.addEventListener('click', async () => {
  if (!awaitingTaskId) return;
  appendLog(`Approved task ${awaitingTaskId}. Committing changes to branch…`);
  currentData = await window.orbit.approvePlanTask({ id: awaitingTaskId });
  document.getElementById('approvalCard').style.display = 'none';
  refreshUI(currentData);
  showToast(`Task ${awaitingTaskId} approved!`);
});

document.getElementById('btnRejectTask')?.addEventListener('click', () => {
  const row = document.getElementById('rejectFeedbackRow');
  row.style.display = row.style.display === 'none' ? 'flex' : 'none';
  document.getElementById('inputRejectReason').focus();
});

document.getElementById('btnConfirmReject')?.addEventListener('click', async () => {
  if (!awaitingTaskId) return;
  const reason = document.getElementById('inputRejectReason').value.trim();
  appendLog(`Rejected task ${awaitingTaskId}: ${reason || 'Fix requested'}`);
  currentData = await window.orbit.rejectPlanTask({ id: awaitingTaskId, reason });
  document.getElementById('approvalCard').style.display = 'none';
  document.getElementById('rejectFeedbackRow').style.display = 'none';
  document.getElementById('inputRejectReason').value = '';
  refreshUI(currentData);
  showToast(`Feedback submitted for task ${awaitingTaskId}`);
});

// Terminal Console Controls
document.getElementById('btnClearLog')?.addEventListener('click', () => {
  const box = document.getElementById('consoleBox');
  if (box) box.textContent = '[console cleared]';
});

document.getElementById('btnCopyLog')?.addEventListener('click', () => {
  const box = document.getElementById('consoleBox');
  if (box) {
    navigator.clipboard.writeText(box.textContent);
    showToast('Console log copied to clipboard');
  }
});

// Doctor & Report Controls
document.getElementById('btnRefreshDoctor')?.addEventListener('click', async () => {
  currentData = await window.orbit.getProjectInfo();
  refreshUI(currentData);
  showToast('Diagnostics refreshed');
});

document.getElementById('btnRefreshReport')?.addEventListener('click', async () => {
  currentData = await window.orbit.getProjectInfo();
  refreshUI(currentData);
  showToast('Report reloaded');
});

document.getElementById('btnOpenReportFile')?.addEventListener('click', async () => {
  if (currentData?.dir) {
    const reportPath = `${currentData.dir}/.orbit/report.md`;
    await window.orbit.openPath(reportPath);
  }
});

// Update Center Controls
document.getElementById('btnCheckUpdates')?.addEventListener('click', async () => {
  const statusEl = document.getElementById('updateStatusText');
  if (statusEl) {
    statusEl.className = 'update-status-pill';
    statusEl.textContent = 'Checking GitHub releases…';
  }
  try {
    const res = await window.orbit.checkUpdates();
    if (res.available) {
      statusEl.className = 'update-status-pill update-ready';
      statusEl.textContent = `Update available: v${res.latest} (current: v${res.current})`;
      showToast(`Update available: v${res.latest}`);
    } else {
      statusEl.className = 'update-status-pill up-to-date';
      statusEl.textContent = `Up to date (v${res.current})`;
      showToast('You are on the latest version!');
    }
  } catch (err) {
    statusEl.className = 'update-status-pill';
    statusEl.textContent = `Check failed: ${err.message}`;
  }
});

// Minimize to Tray
document.getElementById('btnMinimize')?.addEventListener('click', () => {
  window.orbit.hideWindow?.();
});

// Engine IPC Event Listeners
window.orbit.onPlanLog(msg => {
  appendLog(msg);
});

window.orbit.onPlanEvent(ev => {
  if (ev.type === 'snapshot') {
    appendLog(`[engine] Branch ${ev.branch} · Worktree ${ev.worktree}`);
  } else if (ev.type === 'phase') {
    const activeTitle = document.getElementById('activeTaskTitle');
    const attemptTag = document.getElementById('activeAttemptTag');
    if (activeTitle) activeTitle.textContent = `Task ${ev.id} (${ev.phase})`;
    if (attemptTag) {
      attemptTag.textContent = `Attempt ${ev.attempt}/${ev.max}`;
      attemptTag.className = 'badge-tag running';
    }
    appendLog(`[task ${ev.id}] Phase: ${ev.phase} (attempt ${ev.attempt}/${ev.max})`);
  } else if (ev.type === 'task-done') {
    appendLog(`[task ${ev.id}] DONE ✔`);
    window.orbit.getProjectInfo().then(refreshUI);
  } else if (ev.type === 'task-blocked') {
    appendLog(`[task ${ev.id}] BLOCKED ✖: ${ev.error || 'Needs human intervention'}`);
    window.orbit.getProjectInfo().then(refreshUI);
  }
});

window.orbit.onPlanFinished(res => {
  document.getElementById('btnStopPlan').style.display = 'none';
  document.getElementById('btnRunPlan').style.display = 'inline-flex';
  document.getElementById('activeRunSpinner').style.display = 'none';
  document.getElementById('statusPill').className = 'status-indicator-pill ready';
  document.getElementById('statusText').textContent = 'Run Finished';
  stopElapsedTimer();
  appendLog(`[engine] Plan run finished with status: ${res.status}`);
  window.orbit.getProjectInfo().then(refreshUI);
});

window.orbit.onPlanError(errMsg => {
  document.getElementById('btnStopPlan').style.display = 'none';
  document.getElementById('btnRunPlan').style.display = 'inline-flex';
  document.getElementById('activeRunSpinner').style.display = 'none';
  document.getElementById('statusPill').className = 'status-indicator-pill blocked';
  document.getElementById('statusText').textContent = 'Error';
  stopElapsedTimer();
  appendLog(`[engine error] ${errMsg}`);
  showToast(`Execution error: ${errMsg}`);
});

// Startup Initialization
(async function init() {
  try {
    currentData = await window.orbit.getProjectInfo();
    refreshUI(currentData);
  } catch (err) {
    appendLog(`Initialization error: ${err.message}`);
  }
})();
