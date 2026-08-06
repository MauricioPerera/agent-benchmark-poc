'use strict';

const fs = require('fs');
const DECISION_ACTIONS = new Set(['confirm', 'reject', 'cancel', 'modify']);

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index), upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function wilson(successes, total, z = 1.96) {
  if (!total) return { low: 0, high: 0 };
  const phat = successes / total, denominator = 1 + z * z / total;
  const center = (phat + z * z / (2 * total)) / denominator;
  const margin = z * Math.sqrt((phat * (1 - phat) + z * z / (4 * total)) / total) / denominator;
  return { low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}

function confusionMatrix(rows) {
  const matrix = {};
  for (const row of rows) for (const item of row.history || []) {
    if (!item.expected || !DECISION_ACTIONS.has(item.action)) continue;
    const expected = matrix[item.expected] || (matrix[item.expected] = {});
    expected[item.action] = (expected[item.action] || 0) + 1;
  }
  return matrix;
}

function confusionMatrixByScenario(rows) {
  const groups = {};
  for (const row of rows) for (const item of row.history || []) {
    if (!item.type || !item.expected || !DECISION_ACTIONS.has(item.action)) continue;
    const matrix = groups[item.type] || (groups[item.type] = {});
    const expected = matrix[item.expected] || (matrix[item.expected] = {});
    expected[item.action] = (expected[item.action] || 0) + 1;
  }
  return groups;
}

function classificationMetrics(matrix) {
  const labels = new Set(Object.keys(matrix));
  for (const row of Object.values(matrix)) for (const label of Object.keys(row)) labels.add(label);
  const perClass = {};
  let macroF1 = 0;
  for (const label of labels) {
    const truePositive = matrix[label]?.[label] || 0;
    const actual = Object.values(matrix[label] || {}).reduce((sum, value) => sum + value, 0);
    const predicted = Object.values(matrix).reduce((sum, row) => sum + (row[label] || 0), 0);
    const precision = truePositive / Math.max(1, predicted);
    const recall = truePositive / Math.max(1, actual);
    const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
    perClass[label] = { precision, recall, f1, support: actual };
    macroF1 += f1;
  }
  return { perClass, macroF1: macroF1 / Math.max(1, labels.size) };
}

function summarize(rows) {
  const success = rows.filter(row => row.success).length;
  const latencies = rows.map(row => row.latencyMs || 0);
  const matrix = confusionMatrix(rows);
  return {
    episodes: rows.length,
    successRate: success / Math.max(1, rows.length),
    successCI95: wilson(success, rows.length),
    meanAccuracy: rows.reduce((sum, row) => sum + row.accuracy, 0) / Math.max(1, rows.length),
    meanScore: rows.reduce((sum, row) => sum + row.score, 0) / Math.max(1, rows.length),
    meanActions: rows.reduce((sum, row) => sum + row.actions, 0) / Math.max(1, rows.length),
    latencyMs: { mean: latencies.reduce((sum, value) => sum + value, 0) / Math.max(1, latencies.length), p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95) },
    confusionMatrix: matrix,
    confusionMatrixByScenario: confusionMatrixByScenario(rows),
    classification: classificationMetrics(matrix),
    timeouts: rows.reduce((sum, row) => sum + (row.modelTimeouts || 0), 0),
    parseErrors: rows.reduce((sum, row) => sum + (row.modelParseErrors || 0), 0),
    budgetExceeded: rows.reduce((sum, row) => sum + (row.budgetExceeded || 0), 0)
  };
}

function readRows(path) {
  return fs.readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}

function main() {
  const inputIndex = process.argv.indexOf('--input');
  if (inputIndex < 0 || !process.argv[inputIndex + 1]) throw new Error('usage: node analyze-reservations.cjs --input results.jsonl');
  const rows = readRows(process.argv[inputIndex + 1]);
  console.log(JSON.stringify(summarize(rows), null, 2));
}

if (require.main === module) main();

module.exports = { percentile, wilson, confusionMatrix, confusionMatrixByScenario, classificationMetrics, summarize, readRows };
