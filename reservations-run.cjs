'use strict';

const fs = require('fs');
const { createReservationState, observation, step, expectedActions, summary } = require('./reservations.cjs');
const VALID_ACTIONS = new Set(['search', 'create_hold', 'confirm', 'cancel', 'modify', 'reject', 'get_booking', 'inspect_availability', 'inspect_booking', 'inspect_policy']);

function parseArgs(argv) {
  const out = { mode: 'offline', profile: 'standard', episodes: 5, repeats: 1, seed: 30000, cases: 6, model: 'gemma4:cloud', ollama: 'http://127.0.0.1:11434/api/chat', timeoutMs: 120000, maxActions: 40, trace: false, out: null };
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '');
    if (key === 'trace') { out.trace = true; continue; }
    if (['mode', 'profile', 'episodes', 'repeats', 'seed', 'cases', 'model', 'ollama', 'timeout-ms', 'max-actions', 'out'].includes(key)) out[key === 'timeout-ms' ? 'timeoutMs' : key === 'max-actions' ? 'maxActions' : key] = argv[++i];
  }
  for (const key of ['episodes', 'repeats', 'seed', 'cases', 'timeoutMs', 'maxActions']) out[key] = Number(out[key]);
  return out;
}

function actionFrom(text) {
  const raw = String(text || '').trim().replace(/```json|```/g, '').trim();
  const match = raw.match(/\{[\s\S]*\}/);
  const data = JSON.parse(match ? match[0] : raw);
  return { action: String(data.action || '').toLowerCase(), ...(data.idempotencyKey ? { idempotencyKey: String(data.idempotencyKey) } : {}) };
}

async function ollamaAction(config, obs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  const system = 'You are a reservation agent benchmark participant. Apply only the rules in the observation. Always call search before create_hold in the current reservation; inspect_* tools are read-only and do not satisfy this requirement. One search is enough: if the observation already has search_result, do not call search again — act on it (create_hold), unless a rule tells you the version changed. Never repeat an action that already succeeded in this reservation unless a rule requires it (stale version, expired hold); if the observation is unchanged after a successful action, move to the next step of the flow instead of repeating it. If confirm succeeds and the same reservation is still current, call inspect_policy to check whether modify or cancel is required next. Never confirm without a valid hold. For create_hold you may include a stable idempotencyKey for safe retries. Return ONLY JSON with action and optional idempotencyKey. Do not explain.';
  try {
    const response = await fetch(config.ollama, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: config.model, stream: false, format: 'json', options: { temperature: 0 }, messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(obs) }] }), signal: controller.signal });
    if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
    const data = await response.json();
    const action = actionFrom(data.message?.content);
    return VALID_ACTIONS.has(action.action) ? action : '__invalid__';
  } catch (error) {
    if (error.name === 'AbortError') return '__timeout__';
    return '__invalid__';
  } finally { clearTimeout(timer); }
}

function offlineAction(state) {
  const task = state.current;
  if (task.type === 'impossible') return state.searchVersion === null ? 'search' : 'reject';
  if (state.searchVersion === null) return 'search';
  if (task.type === 'stale' && state.searchVersion !== task.version) return 'search';
  if (state.hold && state.hold.expiresAt <= state.clock) return 'create_hold';
  if (!state.hold) return 'create_hold';
  if (!state.booking && task.type !== 'modify_conflict' && task.type !== 'cancel') return 'confirm';
  if (!state.booking) return 'confirm';
  if (task.type === 'modify_conflict') return 'modify';
  if (task.type === 'cancel') return 'cancel';
  return expectedActions(task).at(-1);
}

function scenarioMetrics(rows) {
  const groups = {};
  for (const row of rows) for (const item of row.history) {
    if (!item.type) continue;
    const group = groups[item.type] || (groups[item.type] = { cases: 0, correct: 0, errors: 0, reservations: new Map() });
    const current = group.reservations.get(item.reservation) || { correct: false, errors: 0 };
    if (item.correct) current.correct = true; else { current.errors++; group.errors++; }
    group.reservations.set(item.reservation, current);
  }
  for (const group of Object.values(groups)) {
    group.cases = group.reservations.size;
    group.correct = [...group.reservations.values()].filter(item => item.correct).length;
    group.accuracy = group.correct / Math.max(1, group.cases);
    delete group.reservations;
  }
  return groups;
}

async function main() {
  const config = parseArgs(process.argv), rows = [];
  for (let repeat = 0; repeat < config.repeats; repeat++) for (let i = 0; i < config.episodes; i++) {
    const state = createReservationState(config.seed + i, config.cases, config.profile);
    let latencyMs = 0, modelTimeouts = 0, modelParseErrors = 0, budgetExceeded = 0;
    const agentTrace = [];
    while (!state.done) {
      if (state.actions >= config.maxActions) {
        budgetExceeded++;
        state.errors++;
        state.history.push({ reservation: state.current.id, type: state.current.type, action: '__max_actions__', correct: false, error: 'max_actions_exceeded', errorType: 'runner', critical: false });
        agentTrace.push({ step: state.actions + 1, action: '__max_actions__', result: 'budget_exceeded' });
        state.done = true; state.phase = 'done'; break;
      }
      let action;
      const visible = observation(state);
      if (config.mode === 'ollama') { const started = Date.now(); action = await ollamaAction(config, visible); latencyMs += Date.now() - started; }
      else action = offlineAction(state);
      const actionName = typeof action === 'object' ? action.action : action;
      agentTrace.push({ step: state.actions + 1, action: actionName, ...(typeof action === 'object' && action.idempotencyKey ? { idempotencyKey: action.idempotencyKey } : {}), visible: config.trace ? { search_result: visible.search_result, hold: visible.hold, availability: visible.availability, available_tools: visible.available_tools } : undefined });
      if (actionName === '__timeout__' || actionName === '__invalid__') {
        state.errors++;
        if (actionName === '__timeout__') modelTimeouts++; else modelParseErrors++;
        state.history.push({ reservation: state.current.id, type: state.current.type, action: actionName, correct: false, error: actionName === '__timeout__' ? 'model_timeout' : 'invalid_model_output', errorType: 'model', critical: false });
        state.done = true; state.phase = 'done'; break;
      }
      step(state, action);
    }
    const row = summary(state); row.repeat = repeat + 1; row.latencyMs = latencyMs; row.modelTimeouts = modelTimeouts; row.modelParseErrors = modelParseErrors; row.budgetExceeded = budgetExceeded; if (config.trace) row.agentTrace = agentTrace; rows.push(row);
    console.log(`${row.success ? 'PASS' : 'FAIL'} seed=${row.seed} score=${row.score} accuracy=${(row.accuracy * 100).toFixed(1)}% critical=${row.criticalErrors} protocol=${row.protocolErrors} timeout=${modelTimeouts} invalid_model=${modelParseErrors} budget=${budgetExceeded}`);
  }
  const totalActions = Math.max(1, rows.reduce((sum, row) => sum + row.actions, 0));
  const totalCases = Math.max(1, rows.reduce((sum, row) => sum + row.total, 0));
  const aggregate = {
    domain: 'reservations', profile: config.profile, mode: config.mode, model: config.mode === 'ollama' ? config.model : 'oracle', episodes: rows.length, repeats: config.repeats,
    meanScore: rows.reduce((s, x) => s + x.score, 0) / rows.length,
    meanAccuracy: rows.reduce((s, x) => s + x.accuracy, 0) / rows.length,
    meanActions: rows.reduce((s, x) => s + x.actions, 0) / rows.length,
    meanLatencyMs: rows.reduce((s, x) => s + x.latencyMs, 0) / rows.length,
    episodeSuccessRate: rows.filter(x => x.success).length / rows.length,
    decisionErrorRate: rows.reduce((s, x) => s + x.decisionErrors, 0) / totalCases,
    toolErrorRate: rows.reduce((s, x) => s + x.toolErrors, 0) / totalActions,
    protocolErrorRate: rows.reduce((s, x) => s + x.protocolErrors, 0) / totalActions,
    invalidActionRate: rows.reduce((s, x) => s + x.invalidActions, 0) / totalActions,
    modelTimeoutRate: rows.reduce((s, x) => s + x.modelTimeouts, 0) / rows.length,
    modelParseErrorRate: rows.reduce((s, x) => s + x.modelParseErrors, 0) / rows.length,
    budgetExceededRate: rows.reduce((s, x) => s + x.budgetExceeded, 0) / rows.length,
    byScenario: scenarioMetrics(rows),
    passK: Array.from({ length: config.episodes }, (_, i) => rows.filter(x => x.seed === config.seed + i).every(x => x.success)).filter(Boolean).length / config.episodes,
    rows
  };
  console.log(`RESERVATIONS_SUMMARY ${JSON.stringify(aggregate)}`);
  if (config.out) fs.writeFileSync(config.out, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
}

if (require.main === module) main().catch(error => { console.error(`ERROR: ${error.message}`); process.exitCode = 1; });

module.exports = { parseArgs, actionFrom, offlineAction, scenarioMetrics };
