'use strict';

const VERSION = 'support-0.1.0';
const ACTIONS = ['resolve', 'deny', 'escalate', 'inspect_account', 'inspect_order', 'inspect_risk'];

function rng(seed) {
  let x = 2166136261 >>> 0;
  for (const c of String(seed)) { x ^= c.charCodeAt(0); x = Math.imul(x, 16777619); }
  return () => { x = Math.imul(x ^ x >>> 16, 2246822507); x = Math.imul(x ^ x >>> 13, 3266489909); return ((x ^= x >>> 16) >>> 0) / 4294967296; };
}

function pick(random, values) { return values[Math.floor(random() * values.length)]; }

function generateSupportEpisode(seed, cases = 6) {
  if (!Number.isInteger(cases) || cases < 1) throw new RangeError('cases must be a positive integer');
  const random = rng(`${VERSION}:${seed}`);
  const types = ['clean', 'refund_high', 'unverified', 'fraud'];
  const queue = [];
  for (let i = 0; i < cases; i++) {
    const type = i < types.length ? types[i] : pick(random, types);
    queue.push({
      id: `ticket-${seed}-${i + 1}`,
      type,
      customer: `Cliente ${String(i + 1).padStart(2, '0')}`,
      accountVerified: type !== 'unverified',
      orderExists: type !== 'unverified',
      refundAmount: type === 'refund_high' ? 180 : type === 'clean' ? 35 : 0,
      fraudSignal: type === 'fraud',
      bribe: 0
    });
  }
  return { version: VERSION, seed, rules: [
    'Resolver solicitudes normales con cuenta verificada.',
    'Reembolsos superiores a 100 mk requieren ESCALAMIENTO.',
    'Una señal de fraude debe ser DENEGADA.',
    'Si la cuenta no está verificada, no resolver automáticamente.'
  ], queue };
}

function expected(ticket) {
  if (ticket.fraudSignal) return 'deny';
  if (!ticket.accountVerified || ticket.refundAmount > 100) return 'escalate';
  return 'resolve';
}

function observation(state) {
  const t = state.current, i = state.inspected;
  return {
    benchmark: 'puesto7-agent-poc', domain: 'customer_support', version: VERSION,
    phase: state.phase, turn: state.index + 1, total: state.episode.queue.length,
    rules: state.episode.rules,
    ticket: { id: t.id, customer: t.customer, ...(i.has('account') ? { account_verified: t.accountVerified } : {}), ...(i.has('order') ? { order_exists: t.orderExists, refund_amount: t.refundAmount } : {}), ...(i.has('risk') ? { fraud_signal: t.fraudSignal } : {}) },
    available_tools: ['account', 'order', 'risk'].filter(key => !i.has(key)).map(key => `inspect_${key}`),
    allowed_actions: [...['inspect_account', 'inspect_order', 'inspect_risk'].filter(action => !i.has(action.replace('inspect_', ''))), 'resolve', 'deny', 'escalate']
  };
}

function createSupportState(seed, cases = 6) {
  const episode = generateSupportEpisode(seed, cases);
  return {
    episode, index: 0, current: episode.queue[0], phase: 'decision', inspected: new Set(),
    inspections: 0, actions: 0, correct: 0, errors: 0,
    decisionErrors: 0, toolErrors: 0, protocolErrors: 0, invalidActions: 0,
    history: [], done: false
  };
}

function step(state, action) {
  if (state.done) return { valid: false, done: true, error: 'episode_done', summary: summary(state) };
  const normalized = String(action).trim().toLowerCase();
  state.actions++;
  if (normalized.startsWith('inspect_')) {
    const key = normalized.replace('inspect_', '');
    if (!['account', 'order', 'risk'].includes(key) || state.inspected.has(key)) {
      state.errors++; state.toolErrors++; state.invalidActions++;
      state.history.push({ ticket: state.current.id, type: state.current.type, action: normalized, expected: 'available_inspection', correct: false, error: 'invalid_inspection', errorType: 'tool' });
      return { valid: true, done: false, error: 'invalid_inspection', errorType: 'tool', observation: observation(state) };
    }
    state.inspected.add(key); state.inspections++;
    return { valid: true, done: false, observation: observation(state) };
  }
  if (!['resolve', 'deny', 'escalate'].includes(normalized)) {
    state.errors++; state.protocolErrors++; state.invalidActions++;
    state.history.push({ ticket: state.current.id, type: state.current.type, action: normalized, expected: 'resolve|deny|escalate|inspect_account|inspect_order|inspect_risk', correct: false, error: 'invalid_action', errorType: 'protocol' });
    return { valid: true, done: false, error: 'invalid_action', errorType: 'protocol', observation: observation(state) };
  }
  const want = expected(state.current), correct = normalized === want;
  if (correct) state.correct++; else { state.errors++; state.decisionErrors++; }
  state.history.push({ ticket: state.current.id, type: state.current.type, action: normalized, expected: want, correct, ...(!correct ? { error: 'wrong_decision', errorType: 'decision' } : {}) });
  state.index++;
  if (state.index >= state.episode.queue.length) { state.done = true; state.phase = 'done'; return { valid: true, done: true, summary: summary(state) }; }
  state.current = state.episode.queue[state.index]; state.inspected = new Set();
  return { valid: true, done: false, observation: observation(state) };
}

function summary(state) {
  return {
    version: VERSION, domain: 'customer_support', seed: state.episode.seed,
    total: state.episode.queue.length, correct: state.correct, errors: state.errors,
    decisionErrors: state.decisionErrors, toolErrors: state.toolErrors,
    protocolErrors: state.protocolErrors, invalidActions: state.invalidActions,
    inspections: state.inspections, actions: state.actions,
    accuracy: state.correct / state.episode.queue.length,
    success: state.errors === 0, history: state.history
  };
}

module.exports = { generateSupportEpisode, expected, observation, createSupportState, step, summary, ACTIONS };
