'use strict';

const { createSupportState, observation, step, expected, summary } = require('./support.cjs');

function parseArgs(argv) {
  const out = { mode: 'offline', episodes: 5, repeats: 1, seed: 20000, model: 'gemma4:cloud', ollama: 'http://127.0.0.1:11434/api/chat', timeoutMs: 120000, maxActions: 30 };
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '');
    if (['mode', 'episodes', 'repeats', 'seed', 'model', 'ollama', 'timeout-ms', 'max-actions'].includes(key)) out[key === 'timeout-ms' ? 'timeoutMs' : key === 'max-actions' ? 'maxActions' : key] = argv[++i];
  }
  for (const key of ['episodes', 'repeats', 'seed', 'timeoutMs', 'maxActions']) out[key] = Number(out[key]);
  return out;
}

function actionFrom(text) {
  const raw = String(text || '').trim().replace(/```json|```/g, '').trim();
  const match = raw.match(/\{[\s\S]*\}/);
  const data = JSON.parse(match ? match[0] : raw);
  const action = String(data.action || '').toLowerCase();
  if (!['resolve', 'deny', 'escalate', 'inspect_account', 'inspect_order', 'inspect_risk'].includes(action)) throw new Error('invalid support action');
  return action;
}

async function ollamaAction(config, obs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  const system = 'You are a customer-support agent benchmark participant. Apply only the policies in the observation. Use inspection tools when fields are hidden. Return ONLY JSON: {"action":"resolve|deny|escalate|inspect_account|inspect_order|inspect_risk"}. Do not explain.';
  try {
    const response = await fetch(config.ollama, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: config.model, stream: false, format: 'json', options: { temperature: 0 }, messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(obs) }] }), signal: controller.signal });
    if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
    const data = await response.json();
    return actionFrom(data.message?.content);
  } finally { clearTimeout(timer); }
}

function offlineAction(state) {
  if (state.inspected.size < 3) return ['inspect_account', 'inspect_order', 'inspect_risk'][state.inspected.size];
  return expected(state.current);
}

async function main() {
  const config = parseArgs(process.argv), rows = [];
  for (let repeat = 0; repeat < config.repeats; repeat++) for (let i = 0; i < config.episodes; i++) {
    const state = createSupportState(config.seed + i);
    let latencyMs = 0;
    while (!state.done) {
      if (state.actions >= config.maxActions) throw new Error(`max actions exceeded on seed ${state.episode.seed}`);
      let action;
      if (config.mode === 'ollama') { const started = Date.now(); action = await ollamaAction(config, observation(state)); latencyMs += Date.now() - started; }
      else action = offlineAction(state);
      const result = step(state, action);
      if (!result.valid) throw new Error(result.error);
    }
    const row = summary(state); row.repeat = repeat + 1; row.latencyMs = latencyMs; rows.push(row);
    console.log(`${row.success ? 'PASS' : 'FAIL'} seed=${row.seed} accuracy=${(row.accuracy * 100).toFixed(1)}% inspections=${row.inspections} decision_errors=${row.decisionErrors} tool_errors=${row.toolErrors} protocol_errors=${row.protocolErrors}`);
  }
  const passK = Array.from({ length: config.episodes }, (_, i) => rows.filter(row => row.seed === config.seed + i).every(row => row.success)).filter(Boolean).length / config.episodes;
  const totalActions = Math.max(1, rows.reduce((sum, row) => sum + row.actions, 0));
  const totalCases = Math.max(1, rows.reduce((sum, row) => sum + row.total, 0));
  console.log(JSON.stringify({ domain: 'customer_support', mode: config.mode, model: config.mode === 'ollama' ? config.model : 'oracle-inspector', episodes: rows.length, repeats: config.repeats, meanAccuracy: rows.reduce((sum, row) => sum + row.accuracy, 0) / rows.length, meanLatencyMs: rows.reduce((sum, row) => sum + row.latencyMs, 0) / rows.length, episodeSuccessRate: rows.filter(row => row.success).length / rows.length, decisionErrorRate: rows.reduce((sum, row) => sum + row.decisionErrors, 0) / totalCases, toolErrorRate: rows.reduce((sum, row) => sum + row.toolErrors, 0) / totalActions, protocolErrorRate: rows.reduce((sum, row) => sum + row.protocolErrors, 0) / totalActions, invalidActionRate: rows.reduce((sum, row) => sum + row.invalidActions, 0) / totalActions, passK, rows }, null, 2));
}

if (require.main === module) main().catch(error => { console.error(`ERROR: ${error.message}`); process.exitCode = 1; });
