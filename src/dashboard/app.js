/* local-mcp Dashboard — Client */

const API = '';
let currentConfig = null;
let models = [];

// --- Navigation ---
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    item.classList.add('active');
    document.getElementById('page-' + item.dataset.page).classList.add('active');
    if (item.dataset.page === 'status') refreshStatus();
    if (item.dataset.page === 'logs') refreshLogs();
    if (item.dataset.page === 'models') refreshModels();
    if (item.dataset.page === 'routing') refreshRouting();
  });
});

// --- Toast ---
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2000);
}

// --- Copy to clipboard ---
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-copy]');
  if (!btn) return;
  const text = btn.dataset.copy || btn.closest('.code-block')?.textContent?.replace('Copy', '').trim();
  if (text) {
    navigator.clipboard.writeText(text).then(() => {
      btn.textContent = 'Copied!';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1500);
    });
  }
});

// --- Status Page ---
async function refreshStatus() {
  try {
    const [statusRes, statsRes] = await Promise.all([
      fetch(API + '/api/status'),
      fetch(API + '/api/stats')
    ]);
    const status = await statusRes.json();
    const stats = await statsRes.json();

    document.getElementById('stat-requests').textContent = stats.totalRequests.toLocaleString();
    document.getElementById('stat-tokens').textContent = stats.totalTokens.toLocaleString();
    document.getElementById('stat-saved').textContent = '$' + stats.estimatedCostSaved.toFixed(4);

    const container = document.getElementById('endpoints-container');
    container.innerHTML = '';
    for (const [tier, data] of Object.entries(status)) {
      const d = data;
      container.innerHTML += `
        <div class="endpoint-card">
          <span class="dot ${d.healthy ? 'green' : 'red'}"></span>
          <div class="endpoint-info">
            <div class="name">${tier.toUpperCase()} Endpoint</div>
            <div class="url">${d.url}</div>
            <div class="model">${d.model}</div>
          </div>
          <div class="latency">${d.healthy ? d.latencyMs + 'ms' : 'offline'}</div>
        </div>
      `;
    }
  } catch {
    document.getElementById('endpoints-container').innerHTML =
      '<div class="card" style="color:var(--danger)">Failed to fetch status</div>';
  }
}

// --- Models Page ---
async function refreshModels() {
  try {
    if (models.length === 0) {
      const res = await fetch(API + '/api/models');
      models = await res.json();
    }
    const grid = document.getElementById('model-grid');
    grid.innerHTML = models.map(m => `
      <div class="model-card">
        <div class="name">${m.name}</div>
        <div class="id">${m.id}</div>
        <div class="badges">
          <span class="badge ram">${m.ram} RAM</span>
          <span class="badge speed">${m.speed}</span>
          ${m.tags.map(t => `<span class="badge tag">${t}</span>`).join('')}
        </div>
        <div class="best-for">${m.bestFor}</div>
        <button class="btn sm" data-copy="huggingface-cli download ${m.id}">Download Command</button>
      </div>
    `).join('');
  } catch {
    document.getElementById('model-grid').innerHTML = '<div class="card" style="color:var(--danger)">Failed to load models</div>';
  }
}

// --- Routing Page ---
const TASK_DESCRIPTIONS = {
  ask: 'General-purpose questions',
  reason: 'Deep reasoning and analysis',
  classify: 'Text classification',
  summarize: 'Text summarization',
  code_review: 'Code review for bugs/style',
  explain: 'Explain code or concepts',
  extract: 'Structured data extraction',
  translate: 'Text translation',
  diff_analysis: 'Git diff risk analysis'
};

async function refreshRouting() {
  try {
    const res = await fetch(API + '/api/config');
    currentConfig = await res.json();
    const body = document.getElementById('routing-body');
    body.innerHTML = Object.entries(currentConfig.routing).map(([task, tier]) => `
      <tr>
        <td><code>${task}</code></td>
        <td>
          <select data-task="${task}">
            <option value="fast" ${tier === 'fast' ? 'selected' : ''}>⚡ Fast</option>
            <option value="smart" ${tier === 'smart' ? 'selected' : ''}>🧠 Smart</option>
          </select>
        </td>
        <td style="color:var(--text-muted)">${TASK_DESCRIPTIONS[task] || ''}</td>
      </tr>
    `).join('');
  } catch {
    document.getElementById('routing-body').innerHTML = '<tr><td colspan="3" style="color:var(--danger)">Failed to load config</td></tr>';
  }
}

document.getElementById('save-routing').addEventListener('click', async () => {
  const routing = {};
  document.querySelectorAll('#routing-body select').forEach(sel => {
    routing[sel.dataset.task] = sel.value;
  });
  try {
    await fetch(API + '/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ routing })
    });
    toast('Routing configuration saved');
  } catch {
    toast('Failed to save configuration');
  }
});

// --- Wizard ---
document.getElementById('check-prereqs').addEventListener('click', async () => {
  const results = document.getElementById('prereq-results');
  results.innerHTML = '<span style="color:var(--text-muted)">Checking...</span>';
  try {
    const res = await fetch(API + '/api/check-setup');
    const checks = await res.json();
    results.innerHTML = Object.entries(checks).map(([name, info]) => {
      const i = info;
      const icon = i.installed ? '<span class="dot green" style="vertical-align:middle"></span>' : '<span class="dot red" style="vertical-align:middle"></span>';
      return `<div class="check-result">${icon} <strong>${name}</strong> ${i.installed ? i.version : 'not found'}</div>`;
    }).join('');
    if (checks.python3?.installed && checks.pip3?.installed && checks.mlx_lm?.installed) {
      document.getElementById('step-1').classList.add('done');
    }
  } catch {
    results.innerHTML = '<span style="color:var(--danger)">Check failed</span>';
  }
});

// Wizard model select
async function initWizardModels() {
  if (models.length === 0) {
    try {
      const res = await fetch(API + '/api/models');
      models = await res.json();
    } catch { return; }
  }
  const sel = document.getElementById('wizard-model-select');
  sel.innerHTML = models.map(m => `<option value="${m.id}">${m.name} (${m.ram} RAM, ${m.speed})</option>`).join('');
  updateWizardCommands();
  sel.addEventListener('change', updateWizardCommands);
}

function updateWizardCommands() {
  const sel = document.getElementById('wizard-model-select');
  const modelId = sel.value;
  const dlBlock = document.getElementById('wizard-download-cmd');
  const dlCmd = `huggingface-cli download ${modelId}`;
  dlBlock.childNodes[0].textContent = dlCmd;
  dlBlock.querySelector('.copy-btn').dataset.copy = dlCmd;

  const port = modelId.includes('1.5B') || modelId.includes('2.5-7B') ? '8083' : '8081';
  const serveBlock = document.getElementById('wizard-serve-cmd');
  const serveCmd = `python3 -m mlx_lm.server --model ${modelId} --port ${port}`;
  serveBlock.childNodes[0].textContent = serveCmd;
  serveBlock.querySelector('.copy-btn').dataset.copy = serveCmd;
}

// --- Logs Page ---
async function refreshLogs() {
  try {
    const res = await fetch(API + '/api/logs');
    const logs = await res.json();
    const body = document.getElementById('log-body');
    const empty = document.getElementById('log-empty');
    if (logs.length === 0) {
      body.innerHTML = '';
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';
    body.innerHTML = logs.reverse().map(l => `
      <tr>
        <td class="mono" style="font-size:12px">${new Date(l.timestamp).toLocaleTimeString()}</td>
        <td><code>${l.tool}</code></td>
        <td style="font-size:12px">${l.model?.split('/').pop() || '—'}</td>
        <td class="mono">${l.tokens}</td>
        <td class="mono">${l.latencyMs}ms</td>
        <td class="${l.status === 'ok' ? 'status-ok' : 'status-error'}">${l.status}</td>
      </tr>
    `).join('');
  } catch {
    document.getElementById('log-body').innerHTML = '<tr><td colspan="6" style="color:var(--danger)">Failed to load logs</td></tr>';
  }
}

// --- Auto-refresh ---
let statusInterval;
function startAutoRefresh() {
  refreshStatus();
  statusInterval = setInterval(() => {
    const statusPage = document.getElementById('page-status');
    if (statusPage.classList.contains('active')) refreshStatus();
    const logsPage = document.getElementById('page-logs');
    if (logsPage.classList.contains('active')) refreshLogs();
  }, 10000);
}

// --- Init ---
startAutoRefresh();
initWizardModels();
