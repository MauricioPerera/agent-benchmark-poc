'use strict';

const assert = require('assert');
const { generateEpisode, evaluate, createState, step, summary, heuristic } = require('./benchmark.cjs');
const { scenarioMetrics } = require('./run.cjs');

const a = generateEpisode(42, 5, 10);
const b = generateEpisode(42, 5, 10);
assert.deepStrictEqual(a, b, 'same seed must generate identical episode');
assert.notDeepStrictEqual(a, generateEpisode(43, 5, 10), 'different seed should generate a different episode');
const oodA = generateEpisode(42, 5, 10, 'ood');
assert.deepStrictEqual(oodA, generateEpisode(42, 5, 10, 'ood'), 'same OOD seed must be reproducible');
assert.notDeepStrictEqual(a.rules, oodA.rules, 'OOD profile must vary rule presentation');
assert.deepStrictEqual(a.queue.map(t => t.violation), oodA.queue.map(t => t.violation), 'OOD must preserve scenario semantics');
const coverage = generateEpisode(42, 5, 7).queue.map(t => t.violation);
for (const required of ['clean', 'food', 'weapon', 'wanted', 'food+documents']) assert(coverage.includes(required), `difficulty 5 must cover ${required}`);

const clean = { nation: 'VOSTANIA', age: 30, passportValid: true, permitPresent: true, permitValid: true, permitNameMatches: true, items: [], wanted: false };
const weapon = { ...clean, items: [{ category: 'armas' }] };
const food = { ...clean, items: [{ category: 'comida' }] };
assert.equal(evaluate(clean, { difficulty: 5, allowedNation: 'VOSTANIA' }).expected, 'approve');
assert.equal(evaluate(weapon, { difficulty: 5, allowedNation: 'VOSTANIA' }).expected, 'deny');
assert.equal(evaluate(food, { difficulty: 5, allowedNation: 'VOSTANIA' }).expected, 'confisc');

const state = createState(99, 5, 1);
const first = state.current;
const expected = evaluate(first, state.episode).expected;
const result = step(state, expected);
assert.equal(result.done, true);
assert.equal(summary(state).correct, 1);

for (let seed = 0; seed < 25; seed++) {
  const s = createState(seed, 5, 7);
  while (!s.done) {
    const r = step(s, heuristic(require('./benchmark.cjs').observation(s)));
    assert.equal(r.valid, true);
  }
  assert.equal(summary(s).errors, 0, `heuristic failed seed ${seed}`);
}
for (const profile of ['standard', 'ood']) {
  for (let seed = 0; seed < 10; seed++) {
    const s = createState(seed, 5, 7, profile);
    while (!s.done) step(s, s.phase === 'bribe' ? 'reject_bribe' : evaluate(s.current, s.episode).expected);
    assert.equal(summary(s).errors, 0, `${profile} oracle failed seed ${seed}`);
  }
}
const semantic = generateEpisode(42, 5, 7, 'semantic-ood');
assert.equal(semantic.allowedNation, 'KOLEVIA');
for (let seed = 0; seed < 10; seed++) {
  const s = createState(seed, 5, 7, 'semantic-ood');
  while (!s.done) step(s, s.phase === 'bribe' ? 'reject_bribe' : evaluate(s.current, s.episode).expected);
  assert.equal(summary(s).errors, 0, `semantic-ood oracle failed seed ${seed}`);
}
for (let seed = 0; seed < 10; seed++) {
  const s = createState(seed, 5, 7, 'interactive');
  while (!s.done) step(s, heuristic(require('./benchmark.cjs').observation(s)));
  assert.equal(summary(s).errors, 0, `interactive heuristic failed seed ${seed}`);
  assert.ok(summary(s).inspections >= 3, 'interactive profile must require inspections');
}
for (let seed = 0; seed < 10; seed++) {
  const s = createState(seed, 5, 7, 'interactive-ood');
  while (!s.done) step(s, s.phase === 'bribe' ? 'reject_bribe' : s.inspected.size < 3 ? ['inspect_passport', 'inspect_permit', 'inspect_cargo'].find(tool => !s.inspected.has(tool.replace('inspect_', ''))) : evaluate(s.current, s.episode).expected);
  assert.equal(summary(s).errors, 0, `interactive-ood oracle failed seed ${seed}`);
  assert.equal(summary(s).inspections, 21, 'interactive-ood must inspect three fields per case');
}
const metrics = scenarioMetrics([{ history: [{ violation: 'wanted', correct: false, expected: 'deny' }, { violation: 'clean', correct: true, expected: 'approve' }] }]);
assert.equal(metrics.wanted.accuracy, 0);
assert.equal(metrics.clean.accuracy, 1);

console.log('PASS  deterministic generation');
console.log('PASS  difficulty coverage and compound cases');
console.log('PASS  OOD profile changes wording but preserves semantics');
console.log('PASS  scenario-level diagnostic metrics');
console.log('PASS  partial-observation interactive profile');
console.log('PASS  combined interactive-ood profile');
console.log('PASS  semantic OOD changes policy parameters');
console.log('PASS  precedence deny > confisc > approve');
console.log('PASS  state transitions and terminal summary');
console.log('PASS  heuristic agent solves 25 seeded episodes');
