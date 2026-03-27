/* local-mcp Dashboard — Client v3 */

const API = '';
let currentConfig = null;
let models = [];
let healthHistory = { smart: [], fast: [] };
let defaultTemplates = {};
let hardwareState = null;
let exportFormats = {};

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
    if (item.dataset.page === 'hardware') refreshHardware();
    if (item.dataset.page === 'routing') refreshRouting();
    if (item.dataset.page === 'templates') refreshTemplates();
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

// --- Sparkline ---
function drawSparkline(svgId, values) {
  const svg = document.getElementById(svgId);
  if (!svg || values.length === 0) return;
  svg.innerHTML = '';

  const max = Math.max(...values, 1);
  const w = 200;
  const h = 50;
  const step = values.length > 1 ? w / (values.length - 1) : w;

  const points = values.map((v, i) => {
    const x = i * step;
    const y = h - (v / max) * (h - 4) - 2;
    return `${x},${y}`;
  }).join(' ');

  // Determine color based on latest value
  const latest = values[values.length - 1];
  let color = '#3fb950'; // green
  if (latest > 500) color = '#f85149'; // red
  else if (latest > 100) color = '#d29922'; // yellow

  // Fill area
  const fillPoints = `0,${h} ${points} ${w},${h}`;
  const fill = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  fill.setAttribute('points', fillPoints);
  fill.setAttribute('fill', color);
  fill.setAttribute('fill-opacity', '0.15');
  svg.appendChild(fill);

  // Line
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  line.setAttribute('points', points);
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', color);
  line.setAttribute('stroke-width', '2');
  svg.appendChild(line);

  // Dot on latest
  if (values.length > 0) {
    const lastX = (values.length - 1) * step;
    const lastY = h - (latest / max) * (h - 4) - 2;
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('cx', lastX);
    dot.setAttribute('cy', lastY);
    dot.setAttribute('r', '3');
    dot.setAttribute('fill', color);
    svg.appendChild(dot);
  }

  // Label latest value
  const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  label.setAttribute('x', '196');
  label.setAttribute('y', '12');
  label.setAttribute('fill', color);
  label.setAttribute('font-size', '10');
  label.setAttribute('text-anchor', 'end');
  label.setAttribute('font-family', 'monospace');
  label.textContent = latest + 'ms';
  svg.appendChild(label);
}

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

      // Track latency history
      if (healthHistory[tier]) {
        healthHistory[tier].push(d.healthy ? d.latencyMs : 0);
        if (healthHistory[tier].length > 20) healthHistory[tier].shift();
      }
    }

    // Update sparklines
    drawSparkline('sparkline-smart', healthHistory.smart.filter(v => v > 0));
    drawSparkline('sparkline-fast', healthHistory.fast.filter(v => v > 0));
  } catch {
    document.getElementById('endpoints-container').innerHTML =
      '<div class="card" style="color:var(--danger)">Failed to fetch status</div>';
  }
}

// --- Quick Test ---
document.getElementById('test-run').addEventListener('click', async () => {
  const tool = document.getElementById('test-tool').value;
  const input = document.getElementById('test-input').value.trim();
  if (!input) { toast('Enter some input first'); return; }

  const btn = document.getElementById('test-run');
  btn.disabled = true;
  btn.textContent = 'Running...';
  document.getElementById('test-output').style.display = 'none';

  try {
    const res = await fetch(API + '/api/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool, input })
    });
    const data = await res.json();
    document.getElementById('test-output').style.display = 'block';

    if (data.error) {
      document.getElementById('test-meta').innerHTML = `<span style="color:var(--danger)">Error</span>`;
      document.getElementById('test-result').textContent = data.error;
    } else {
      document.getElementById('test-meta').innerHTML =
        `<span class="badge speed">${data.latencyMs}ms</span> ` +
        `<span class="badge ram">${data.tokens} tokens</span> ` +
        `<span class="badge tag">${data.model?.split('/').pop() || '—'}</span>` +
        ` <span class="badge tag">${data.tool}</span>`;
      document.getElementById('test-result').textContent = data.result;
    }
  } catch (err) {
    document.getElementById('test-output').style.display = 'block';
    document.getElementById('test-meta').innerHTML = '<span style="color:var(--danger)">Request failed</span>';
    document.getElementById('test-result').textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Run';
  }
});

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
        <div class="name">${m.name}${m.recommended ? ' ⭐' : ''}</div>
        <div class="id">${m.id}</div>
        <div class="badges">
          <span class="badge ram">${m.ram} RAM</span>
          <span class="badge speed">${m.speed}</span>
          ${m.tags.map(t => `<span class="badge tag">${t}</span>`).join('')}
        </div>
        <div class="best-for">${m.bestFor}</div>
        <button class="btn sm" data-copy="huggingface-cli download ${m.id} --local-dir ~/.cache/huggingface/hub/${m.id.replace(/\//g, '--')}">Copy Download Command</button>
      </div>
    `).join('');
  } catch {
    document.getElementById('model-grid').innerHTML = '<div class="card" style="color:var(--danger)">Failed to load models</div>';
  }
}

function fitBadgeClass(fit) {
  return `fit-${fit}`;
}

function titleCaseFit(fit) {
  return fit.replace('_', ' ');
}

async function refreshHardware() {
  try {
    const res = await fetch(API + '/api/hardware');
    hardwareState = await res.json();
    document.getElementById('hardware-stats').innerHTML = `
      <div class="stat-box"><div class="value">${hardwareState.totalRamGB}</div><div class="label">Total RAM GB</div></div>
      <div class="stat-box"><div class="value">${hardwareState.freeRamGB}</div><div class="label">Free RAM GB</div></div>
      <div class="stat-box"><div class="value">${hardwareState.isAppleSilicon ? 'Yes' : 'No'}</div><div class="label">Apple Silicon</div></div>
      <div class="stat-box"><div class="value">${hardwareState.vramGB ?? '—'}</div><div class="label">VRAM GB</div></div>
    `;

    document.getElementById('hardware-grid').innerHTML = hardwareState.models.map(model => `
      <div class="hardware-card">
        <div class="title">
          <span>${model.name}${model.recommended ? ' ⭐' : ''}</span>
          <span class="fit-badge ${fitBadgeClass(model.fit)}">${titleCaseFit(model.fit)}</span>
        </div>
        <div class="subtitle">${model.id}</div>
        <div class="details">
          <div><strong>RAM:</strong> ${model.ram}</div>
          <div><strong>Speed:</strong> ${model.speedTps} t/s</div>
          <div><strong>Tier:</strong> ${model.tier}</div>
          <div><strong>Best for:</strong> ${model.bestFor}</div>
        </div>
      </div>
    `).join('');

    const envSnippet =
      `LOCAL_MCP_SMART_MODEL=${hardwareState.recommended.smart || ''}\n` +
      `LOCAL_MCP_FAST_MODEL=${hardwareState.recommended.fast || ''}\n` +
      `LOCAL_MCP_SMART_URL=http://localhost:8081\n` +
      `LOCAL_MCP_FAST_URL=http://localhost:8083`;
    document.getElementById('hardware-env').textContent = envSnippet;
  } catch {
    document.getElementById('hardware-stats').innerHTML =
      '<div class="card" style="color:var(--danger)">Failed to load hardware data</div>';
    document.getElementById('hardware-grid').innerHTML = '';
  }
}

document.getElementById('copy-hardware-env').addEventListener('click', async () => {
  const text = document.getElementById('hardware-env').textContent;
  await navigator.clipboard.writeText(text);
  toast('Copied .env snippet');
});

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

// --- Export Config ---
document.getElementById('export-config').addEventListener('click', async () => {
  const modal = document.getElementById('export-modal');
  if (!Object.keys(exportFormats).length) {
    const res = await fetch(API + '/api/mcp-config');
    exportFormats = await res.json();
  }
  modal.style.display = 'flex';
  showExportFormat('claude');
});

document.getElementById('close-modal').addEventListener('click', () => {
  document.getElementById('export-modal').style.display = 'none';
});

document.getElementById('export-modal').addEventListener('click', e => {
  if (e.target === e.currentTarget) e.currentTarget.style.display = 'none';
});

document.querySelectorAll('.modal-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    showExportFormat(tab.dataset.format);
  });
});

function showExportFormat(format) {
  const code = document.getElementById('export-code');
  const data = exportFormats[format];
  if (!data) return;
  code.textContent = JSON.stringify(data, null, 2);
  highlightJson(code);
}

function highlightJson(pre) {
  const text = pre.textContent;
  pre.innerHTML = text
    .replace(/"([^"]+)"(?=\s*:)/g, '<span class="hl-key">"$1"</span>')
    .replace(/:\s*"([^"]+)"/g, ': <span class="hl-str">"$1"</span>')
    .replace(/:\s*(true|false|null)/g, ': <span class="hl-bool">$1</span>');
}

document.getElementById('copy-export').addEventListener('click', () => {
  const text = document.getElementById('export-code').textContent;
  navigator.clipboard.writeText(text).then(() => toast('Copied to clipboard'));
});

// --- Templates ---
const TEMPLATE_HINTS = {
  code_review: '{language}, {focus}, {code}',
  explain: '{level}, {content}',
  classify: '{categories}, {text}',
  summarize: '{format}, {max_words_hint}, {text}',
  diff_analysis: '{context_hint}, {diff}',
  extract: '{schema}, {text}'
};

async function refreshTemplates() {
  try {
    const res = await fetch(API + '/api/templates');
    const data = await res.json();
    defaultTemplates = data.defaults;
    const container = document.getElementById('templates-container');
    container.innerHTML = Object.entries(data.templates).map(([name, tmpl]) => `
      <div class="card template-card">
        <div class="template-header">
          <code>${name}</code>
          <span class="template-hint">${TEMPLATE_HINTS[name] || ''}</span>
        </div>
        <textarea class="template-textarea" data-template="${name}" rows="3">${tmpl}</textarea>
      </div>
    `).join('');
  } catch {
    document.getElementById('templates-container').innerHTML =
      '<div class="card" style="color:var(--danger)">Failed to load templates</div>';
  }
}

document.getElementById('save-templates').addEventListener('click', async () => {
  const templates = {};
  document.querySelectorAll('.template-textarea').forEach(ta => {
    templates[ta.dataset.template] = ta.value;
  });
  try {
    await fetch(API + '/api/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templates })
    });
    toast('Templates saved');
  } catch {
    toast('Failed to save templates');
  }
});

document.getElementById('reset-templates').addEventListener('click', () => {
  document.querySelectorAll('.template-textarea').forEach(ta => {
    const name = ta.dataset.template;
    if (defaultTemplates[name]) ta.value = defaultTemplates[name];
  });
  toast('Reset to defaults (save to persist)');
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
  const safeName = modelId.replace(/\//g, '--');
  const dlCmd = `huggingface-cli download ${modelId} --local-dir ~/.cache/huggingface/hub/${safeName}`;
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
function startAutoRefresh() {
  refreshStatus();
  setInterval(() => {
    const statusPage = document.getElementById('page-status');
    if (statusPage.classList.contains('active')) refreshStatus();
  }, 10000);
  setInterval(() => {
    const logsPage = document.getElementById('page-logs');
    if (logsPage.classList.contains('active')) refreshLogs();
  }, 5000);
}

// --- Init ---
startAutoRefresh();
initWizardModels();
refreshHardware();
