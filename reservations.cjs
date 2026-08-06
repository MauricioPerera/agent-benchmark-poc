'use strict';

const VERSION = 'reservations-0.1.0';
const ACTIONS = [
  'search', 'create_hold', 'confirm', 'cancel', 'modify', 'reject', 'get_booking',
  'inspect_availability', 'inspect_booking', 'inspect_policy'
];

function rng(seed) {
  let x = 2166136261 >>> 0;
  for (const c of String(seed)) { x ^= c.charCodeAt(0); x = Math.imul(x, 16777619); }
  return () => { x = Math.imul(x ^ x >>> 16, 2246822507); x = Math.imul(x ^ x >>> 13, 3266489909); return ((x ^= x >>> 16) >>> 0) / 4294967296; };
}

function pick(random, values) { return values[Math.floor(random() * values.length)]; }

const TYPES = ['simple', 'stale', 'expired_hold', 'modify_conflict', 'cancel', 'impossible'];

function generateReservationEpisode(seed, cases = 6, profile = 'standard') {
  if (!Number.isInteger(cases) || cases < 1) throw new RangeError('cases must be a positive integer');
  if (!['standard', 'ood', 'semantic-ood'].includes(profile)) throw new RangeError('unsupported reservation profile');
  const random = rng(`${VERSION}:${seed}`);
  const ood = profile !== 'standard';
  const queue = [];
  for (let i = 0; i < cases; i++) {
    const type = i < TYPES.length ? TYPES[i] : pick(random, TYPES);
    const resource = `${ood ? 'venue' : 'resource'}-${Math.floor(random() * 4) + 1}`;
    const day = (ood ? 20 : 10) + Math.floor(random() * 10);
    const hour = 17 + Math.floor(random() * 5);
    queue.push({
      id: `reservation-${seed}-${i + 1}`,
      type,
      customer: `Cliente ${String(i + 1).padStart(2, '0')}`,
      resource,
      requestedSlot: `2026-09-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00`,
      capacity: type === 'impossible' ? 0 : 1,
      version: 1,
      holdExpiresAt: type === 'expired_hold' ? 0 : 2 + Math.floor(random() * 3),
      policy: { cancellationAllowed: type === 'cancel', modificationAllowed: type === 'modify_conflict' }
    });
  }
  return { version: VERSION, seed, profile, rules: ood ? [
    'A hold requires a prior search in the current reservation; inspection tools do not satisfy this.',
    'One search is enough: once search_result is present, act on it immediately (create_hold, or search again only after a version change).',
    'Never repeat an action that already succeeded in the current reservation unless a rule requires it (stale version, expired hold). If the observation is unchanged after a successful action, move to the next step of the flow.',
    'A reservation requires a live hold before finalization.',
    'Refresh the availability revision after an external change.',
    'Rejected amendments leave the original booking untouched.',
    'Retries with the same idempotency key must be side-effect free.',
    'If confirm succeeds and the same reservation is still current, inspect_policy: modificationAllowed means call modify next, cancellationAllowed means call cancel next.'
  ] : [
    'Un hold requiere una búsqueda (search) previa en la reserva actual; las inspecciones no reemplazan esa búsqueda.',
    'Con una sola búsqueda alcanza: si `search_result` ya aparece en la observación, actuar de inmediato (create_hold), y solo volver a buscar si cambia la versión.',
    'Nunca repetir una acción que ya tuvo éxito en la reserva actual salvo que una regla lo exija (versión obsoleta, hold vencido). Si la observación no cambió tras una acción exitosa, corresponde avanzar al siguiente paso del flujo.',
    'Nunca confirmar una reserva sin un hold vigente.',
    'Una versión obsoleta exige volver a consultar disponibilidad.',
    'Una modificación inválida conserva intacta la reserva original.',
    'Las operaciones repetidas con la misma clave de idempotencia no duplican efectos.',
    'Si `confirm` tuvo éxito y la misma reserva sigue activa, consultar `inspect_policy`: `modificationAllowed` implica llamar `modify` a continuación, `cancellationAllowed` implica llamar `cancel` a continuación.'
  ], queue };
}

function createReservationState(seed, cases = 6, profile = 'standard') {
  const episode = generateReservationEpisode(seed, cases, profile);
  const state = {
    episode, index: 0, current: null, phase: 'decision', inspected: new Set(),
    actions: 0, inspections: 0, correct: 0, errors: 0, criticalErrors: 0,
    decisionErrors: 0, toolErrors: 0, protocolErrors: 0, invalidActions: 0,
    history: [], done: false, clock: 0, booking: null, hold: null, searchVersion: null,
    idempotency: new Map()
  };
  loadCurrent(state);
  return state;
}

function loadCurrent(state) {
  state.current = state.episode.queue[state.index];
  state.phase = 'decision'; state.inspected = new Set(); state.booking = null;
  state.hold = null; state.searchVersion = null; state.clock = 0;
}

function expectedActions(task) {
  switch (task.type) {
    case 'simple': return ['search', 'create_hold', 'confirm'];
    case 'stale': return ['search', 'search', 'create_hold', 'confirm'];
    case 'expired_hold': return ['search', 'create_hold', 'search', 'create_hold', 'confirm'];
    case 'modify_conflict': return ['search', 'create_hold', 'confirm', 'modify'];
    case 'cancel': return ['search', 'create_hold', 'confirm', 'cancel'];
    case 'impossible': return ['search', 'reject'];
    default: return ['search'];
  }
}

function expected(task) { return expectedActions(task).at(-1); }

function observation(state) {
  const t = state.current;
  const i = state.inspected;
  return {
    benchmark: 'puesto7-agent-poc', domain: 'reservations', version: VERSION, profile: state.episode.profile,
    phase: state.phase, turn: state.index + 1, total: state.episode.queue.length,
    rules: state.episode.rules,
    request: { id: t.id, customer: t.customer, resource: t.resource, slot: t.requestedSlot },
    search_result: state.searchVersion === null ? undefined : { available: t.capacity > 0, version: state.searchVersion },
    hold: state.hold || undefined,
    availability: i.has('availability') ? { capacity: t.capacity, version: t.version } : undefined,
    booking: i.has('booking') ? state.booking : undefined,
    policy: i.has('policy') ? t.policy : undefined,
    available_tools: ['availability', 'booking', 'policy'].filter(key => !i.has(key)).map(key => `inspect_${key}`),
    allowed_actions: [...ACTIONS]
  };
}

function record(state, action, correct, error, errorType, critical = false) {
  if (correct) state.correct++;
  else {
    state.errors++;
    if (errorType === 'decision') state.decisionErrors++;
    if (errorType === 'tool') state.toolErrors++;
    if (errorType === 'protocol') { state.protocolErrors++; state.invalidActions++; }
    if (critical) { state.criticalErrors++; }
  }
  state.history.push({ reservation: state.current.id, type: state.current.type, action, expected: expected(state.current), correct, ...(error ? { error, errorType } : {}), critical });
}

function finishCase(state, action, correct, error, errorType, critical = false) {
  record(state, action, correct, error, errorType, critical);
  // Cada reserva es una tarea independiente: un fallo resuelve negativamente
  // la tarea actual, pero no debe ocultar las siguientes del episodio.
  if (state.index + 1 >= state.episode.queue.length) {
    state.done = true; state.phase = 'done';
    return { valid: true, done: true, summary: summary(state) };
  }
  state.index++; loadCurrent(state);
  return { valid: true, done: false, observation: observation(state) };
}

function step(state, action) {
  if (state.done) return { valid: false, done: true, error: 'episode_done', summary: summary(state) };
  const payload = action && typeof action === 'object' ? action : { action };
  const normalized = String(payload.action).trim().toLowerCase();
  const idempotencyKey = payload.idempotencyKey ? String(payload.idempotencyKey) : null;
  state.actions++;
  if (normalized.startsWith('inspect_')) {
    const key = normalized.replace('inspect_', '');
    if (!['availability', 'booking', 'policy'].includes(key) || state.inspected.has(key)) {
      state.errors++; state.toolErrors++; state.invalidActions++;
      state.history.push({ reservation: state.current.id, action: normalized, correct: false, error: 'invalid_inspection', errorType: 'tool', critical: false });
      return { valid: true, done: false, error: 'invalid_inspection', errorType: 'tool', observation: observation(state) };
    }
    state.inspected.add(key); state.inspections++;
    return { valid: true, done: false, observation: observation(state) };
  }
  if (!ACTIONS.filter(name => !name.startsWith('inspect_')).includes(normalized)) {
    state.errors++; state.protocolErrors++; state.invalidActions++;
    state.history.push({ reservation: state.current.id, action: normalized, correct: false, error: 'invalid_action', errorType: 'protocol', critical: false });
    return { valid: true, done: false, error: 'invalid_action', errorType: 'protocol', observation: observation(state) };
  }
  const task = state.current;
  if (normalized === 'search') {
    state.searchVersion = task.version;
    state.clock++;
    if (task.type === 'stale' && state.clock === 1) task.version++;
    return { valid: true, done: false, observation: observation(state) };
  }
  if (normalized === 'create_hold') {
    const fingerprint = JSON.stringify({ action: normalized, reservation: state.current.id });
    const previous = idempotencyKey ? state.idempotency.get(idempotencyKey) : null;
    if (previous) {
      if (previous.fingerprint !== fingerprint) {
        state.errors++; state.toolErrors++;
        state.history.push({ reservation: state.current.id, type: state.current.type, action: normalized, expected: expected(state.current), correct: false, error: 'idempotency_conflict', errorType: 'tool', critical: false });
        return { valid: true, done: false, error: 'idempotency_conflict', errorType: 'tool', observation: observation(state) };
      }
      return { ...previous.result, replayed: true };
    }
    if (state.searchVersion === null) return finishCase(state, normalized, false, 'search_required', 'tool', false);
    if (task.capacity < 1) return finishCase(state, normalized, false, 'no_availability', 'decision', true);
    if (task.type === 'stale' && state.searchVersion !== task.version) return finishCase(state, normalized, false, 'stale_version', 'tool', false);
    const duration = task.type === 'expired_hold' && state.hold ? 3 : task.holdExpiresAt;
    state.hold = { id: `hold-${task.id}`, expiresAt: state.clock + duration, version: task.version };
    const result = { valid: true, done: false, observation: observation(state) };
    if (idempotencyKey) state.idempotency.set(idempotencyKey, { fingerprint, result });
    return result;
  }
  if (normalized === 'confirm') {
    if (!state.hold || state.clock >= state.hold.expiresAt) return finishCase(state, normalized, false, 'hold_expired', 'decision', true);
    state.booking = { id: `booking-${task.id}`, resource: task.resource, slot: task.requestedSlot, status: 'confirmed' };
    if (task.type === 'modify_conflict' || task.type === 'cancel') return { valid: true, done: false, observation: observation(state) };
    return finishCase(state, normalized, true);
  }
  if (normalized === 'cancel') {
    if (task.type !== 'cancel' || !state.booking) return finishCase(state, normalized, false, 'not_cancellable', 'decision', true);
    state.booking.status = 'cancelled';
    return finishCase(state, normalized, true);
  }
  if (normalized === 'modify') {
    if (task.type !== 'modify_conflict' || !state.booking) return finishCase(state, normalized, false, 'modification_conflict', 'decision', true);
    return finishCase(state, normalized, true);
  }
  if (normalized === 'reject') {
    return finishCase(state, normalized, task.type === 'impossible', task.type === 'impossible' ? undefined : 'unexpected_rejection', 'decision', task.type !== 'impossible');
  }
  if (normalized === 'get_booking') {
    return { valid: true, done: false, observation: observation(state) };
  }
  return finishCase(state, normalized, false, 'unsupported', 'protocol');
}

function summary(state) {
  const total = state.episode.queue.length;
  return {
    version: VERSION, domain: 'reservations', seed: state.episode.seed, total,
    correct: state.correct, errors: state.errors, criticalErrors: state.criticalErrors,
    decisionErrors: state.decisionErrors, toolErrors: state.toolErrors,
    protocolErrors: state.protocolErrors, invalidActions: state.invalidActions,
    inspections: state.inspections, actions: state.actions, accuracy: state.correct / total,
    score: state.criticalErrors > 0 ? 0 : Math.max(0, Math.round((state.correct / total) * 70 + Math.max(0, 30 - state.errors * 5))),
    success: state.errors === 0, history: state.history
  };
}

function runReservationOracle(seed, options = {}) {
  const state = createReservationState(seed, options.cases ?? 6, options.profile ?? 'standard');
  while (!state.done) {
    const currentIndex = state.index;
    for (const action of expectedActions(state.current)) {
      step(state, action);
      if (state.done || state.index !== currentIndex) break;
    }
  }
  return summary(state);
}

module.exports = { VERSION, ACTIONS, generateReservationEpisode, expected, expectedActions, observation, createReservationState, step, summary, runReservationOracle };
