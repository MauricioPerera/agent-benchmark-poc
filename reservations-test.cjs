'use strict';

const assert = require('assert/strict');
const { generateReservationEpisode, createReservationState, observation, step, summary, runReservationOracle } = require('./reservations.cjs');

function test(name, fn) { fn(); console.log(`PASS  ${name}`); }
function finish(state) { while (!state.done) { const type = state.current.type; if (type === 'simple') { step(state, 'search'); step(state, 'create_hold'); step(state, 'confirm'); } else break; } return summary(state); }

test('generation is deterministic and covers reservation cases', () => {
  const a = generateReservationEpisode('fixed', 8);
  assert.deepEqual(a, generateReservationEpisode('fixed', 8));
  assert.notDeepEqual(a.queue[0].requestedSlot, generateReservationEpisode('other-seed', 8).queue[0].requestedSlot);
  const ood = generateReservationEpisode('fixed', 8, 'ood');
  assert.equal(ood.queue[0].type, a.queue[0].type);
  assert.notEqual(ood.queue[0].resource, a.queue[0].resource);
  assert.notDeepEqual(ood.rules, a.rules);
  assert.deepEqual(a.queue.slice(0, 6).map(x => x.type), ['simple', 'stale', 'expired_hold', 'modify_conflict', 'cancel', 'impossible']);
  assert.throws(() => generateReservationEpisode(1, 0), { name: 'RangeError' });
});

test('inspection is partial and cannot be repeated', () => {
  const state = createReservationState(1, 1);
  assert.equal(observation(state).availability, undefined);
  const first = step(state, 'inspect_availability');
  assert.equal(first.observation.availability.capacity, 1);
  const repeated = step(state, 'inspect_availability');
  assert.equal(repeated.error, 'invalid_inspection');
  assert.equal(state.toolErrors, 1);
});

test('search exposes a result without revealing hidden policy fields', () => {
  const state = createReservationState(11, 1);
  const result = step(state, 'search');
  assert.deepEqual(result.observation.search_result, { available: true, version: 1 });
  assert.equal(result.observation.policy, undefined);
  assert.equal(result.observation.booking, undefined);
});

test('creating a hold exposes its receipt for the next action', () => {
  const state = createReservationState(12, 1);
  step(state, 'search');
  const result = step(state, 'create_hold');
  assert.equal(result.observation.hold.id, 'hold-reservation-12-1');
  assert.equal(result.observation.policy, undefined);
});

test('simple oracle never violates capacity', () => {
  const report = runReservationOracle(2, { cases: 1 });
  assert.equal(report.success, true);
  assert.equal(report.criticalErrors, 0);
  assert.equal(report.accuracy, 1);
});

test('invalid protocol action does not consume the reservation', () => {
  const state = createReservationState(3, 1);
  const result = step(state, 'transfer');
  assert.equal(result.errorType, 'protocol');
  assert.equal(state.index, 0);
  assert.equal(state.invalidActions, 1);
});

test('a terminal failure advances to the next independent reservation', () => {
  const state = createReservationState(37, 2);
  const first = state.current.id;
  const result = step(state, 'reject');
  assert.equal(result.done, false);
  assert.notEqual(state.current.id, first);
  assert.equal(state.index, 1);
  assert.equal(state.errors, 1);
});

test('creating a hold requires a fresh search first', () => {
  const state = createReservationState(14, 1);
  const result = step(state, 'create_hold');
  assert.equal(state.history.at(-1).error, 'search_required');
  assert.equal(state.history.at(-1).errorType, 'tool');
  assert.equal(state.index, 0);
});

test('repeating create_hold with the same idempotency key is safe', () => {
  const state = createReservationState(15, 1);
  step(state, 'search');
  const first = step(state, { action: 'create_hold', idempotencyKey: 'retry-1' });
  const second = step(state, { action: 'create_hold', idempotencyKey: 'retry-1' });
  assert.equal(first.observation.hold.id, second.observation.hold.id);
  assert.equal(second.replayed, true);
  assert.equal(state.toolErrors, 0);
});

test('reusing an idempotency key for another reservation is rejected', () => {
  const state = createReservationState(16, 2);
  step(state, 'search');
  step(state, { action: 'create_hold', idempotencyKey: 'shared-key' });
  step(state, 'confirm');
  step(state, 'search');
  const before = state.hold;
  step(state, { action: 'create_hold', idempotencyKey: 'shared-key' });
  assert.equal(state.history.at(-1).error, 'idempotency_conflict');
  assert.equal(state.toolErrors, 1);
  assert.deepEqual(state.hold, before);
});

test('operational errors reduce score even when the final decision is correct', () => {
  const state = createReservationState(13, 1);
  step(state, 'inspect_availability');
  step(state, 'inspect_availability');
  step(state, 'search');
  step(state, 'create_hold');
  step(state, 'confirm');
  assert.equal(summary(state).accuracy, 1);
  assert.equal(summary(state).score, 95);
  assert.equal(summary(state).success, false);
});

test('impossible request is a critical decision if agent creates a hold', () => {
  const state = createReservationState(5, 6);
  while (state.current.type !== 'impossible') {
    const index = state.index;
    for (const action of require('./reservations.cjs').expectedActions(state.current)) {
      step(state, action);
      if (state.index !== index || state.done) break;
    }
  }
  step(state, 'search');
  step(state, 'create_hold');
  assert.equal(summary(state).history.at(-1).error, 'no_availability');
  assert.equal(state.criticalErrors, 1);
});

test('oracle handles all generated reservation scenarios', () => {
  for (let seed = 0; seed < 10; seed++) {
    const report = runReservationOracle(seed);
    assert.equal(report.success, true);
    assert.equal(report.criticalErrors, 0);
    assert.equal(report.accuracy, 1);
  }
});

test('oracle preserves semantics across OOD profiles', () => {
  for (const profile of ['ood', 'semantic-ood']) {
    const report = runReservationOracle(21, { cases: 6, profile });
    assert.equal(report.success, true);
    assert.equal(report.accuracy, 1);
  }
});

test('steps after completion do not mutate metrics', () => {
  const state = createReservationState(6, 1);
  finish(state);
  const before = summary(state);
  assert.equal(step(state, 'search').error, 'episode_done');
  assert.deepEqual(summary(state), before);
});
