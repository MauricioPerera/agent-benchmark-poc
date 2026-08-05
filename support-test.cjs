'use strict';

const assert = require('assert/strict');
const {
  generateSupportEpisode, createSupportState, expected, observation, step, summary
} = require('./support.cjs');

function test(name, fn) {
  fn();
  console.log(`PASS  ${name}`);
}

function finishWithOracle(state) {
  while (!state.done) step(state, expected(state.current));
  return summary(state);
}

test('generation is deterministic and covers every base case', () => {
  const first = generateSupportEpisode('fixed-seed', 12);
  const second = generateSupportEpisode('fixed-seed', 12);
  assert.deepEqual(first, second);
  assert.deepEqual(first.queue.slice(0, 4).map(ticket => ticket.type), ['clean', 'refund_high', 'unverified', 'fraud']);
  assert.deepEqual(first.queue.slice(0, 4).map(expected), ['resolve', 'escalate', 'escalate', 'deny']);
  assert.throws(() => generateSupportEpisode(1, 0), { name: 'RangeError', message: 'cases must be a positive integer' });
});

test('inspection reveals only the requested field and cannot be repeated', () => {
  const state = createSupportState(10, 1);
  assert.equal(observation(state).ticket.account_verified, undefined);
  const inspected = step(state, 'inspect_account');
  assert.equal(inspected.observation.ticket.account_verified, true);
  assert.equal(inspected.observation.ticket.refund_amount, undefined);

  const repeated = step(state, 'inspect_account');
  assert.equal(repeated.errorType, 'tool');
  assert.equal(repeated.error, 'invalid_inspection');
  assert.equal(state.index, 0);
  assert.equal(state.toolErrors, 1);
  assert.equal(state.decisionErrors, 0);
  assert.equal(state.protocolErrors, 0);
});

test('wrong decisions are distinct from tool and protocol errors', () => {
  const state = createSupportState(20, 1);
  const result = step(state, 'deny');
  const report = result.summary;
  assert.equal(report.decisionErrors, 1);
  assert.equal(report.toolErrors, 0);
  assert.equal(report.protocolErrors, 0);
  assert.equal(report.invalidActions, 0);
  assert.equal(report.history[0].errorType, 'decision');
  assert.equal(report.success, false);
});

test('unsupported actions are protocol errors and do not consume a ticket', () => {
  const state = createSupportState(30, 1);
  const result = step(state, 'transfer');
  assert.equal(result.errorType, 'protocol');
  assert.equal(state.index, 0);
  assert.equal(state.protocolErrors, 1);
  assert.equal(state.toolErrors, 0);
  assert.equal(state.decisionErrors, 0);
  assert.equal(state.invalidActions, 1);
});

test('oracle flow is deterministic across seeds and inspection depths', () => {
  for (let seed = 0; seed < 10; seed++) {
    const direct = finishWithOracle(createSupportState(seed));
    const inspectedState = createSupportState(seed);
    while (!inspectedState.done) {
      step(inspectedState, 'inspect_account');
      step(inspectedState, 'inspect_order');
      step(inspectedState, 'inspect_risk');
      step(inspectedState, expected(inspectedState.current));
    }
    const inspected = summary(inspectedState);
    assert.equal(direct.errors, 0);
    assert.equal(direct.accuracy, 1);
    assert.equal(inspected.errors, 0);
    assert.equal(inspected.accuracy, 1);
    assert.equal(inspected.inspections, inspected.total * 3);
  }
});

test('steps after completion are rejected without mutating metrics', () => {
  const state = createSupportState(40, 1);
  finishWithOracle(state);
  const before = summary(state);
  const result = step(state, 'resolve');
  assert.equal(result.valid, false);
  assert.equal(result.error, 'episode_done');
  assert.deepEqual(summary(state), before);
});
