'use strict';

const fs = require('fs');
const { wilson } = require('./analyze-reservations.cjs');

function analyzeResult(result) {
  const items = (result.summary.rows || []).flatMap(row => row.history || []);
  const scenarios = {};
  for (const item of items) {
    if (!item.type) continue;
    const group = scenarios[item.type] || (scenarios[item.type] = { correct: 0, total: 0, errors: 0 });
    group.total++;
    if (item.correct) group.correct++;
    else group.errors++;
  }
  for (const group of Object.values(scenarios)) {
    group.accuracy = group.correct / Math.max(1, group.total);
    group.accuracyCI95 = wilson(group.correct, group.total);
  }
  const summary = result.summary;
  return {
    suite: result.suite,
    model: result.model,
    meanAccuracy: summary.meanAccuracy,
    accuracyCI95: wilson(items.filter(item => item.correct).length, items.length),
    episodeSuccessRate: summary.episodeSuccessRate,
    meanLatencyMs: summary.meanLatencyMs,
    decisionErrorRate: summary.decisionErrorRate,
    toolErrorRate: summary.toolErrorRate,
    protocolErrorRate: summary.protocolErrorRate,
    modelParseErrorRate: summary.modelParseErrorRate,
    budgetExceededRate: summary.budgetExceededRate,
    scenarios
  };
}

function analyzeReport(report) {
  return { version: report.version, generatedAt: new Date().toISOString(), results: report.results.map(analyzeResult) };
}

function main() {
  const inputIndex = process.argv.indexOf('--input');
  if (inputIndex < 0 || !process.argv[inputIndex + 1]) throw new Error('usage: node analyze-protocol.cjs --input report.json [--out analysis.json]');
  const analysis = analyzeReport(JSON.parse(fs.readFileSync(process.argv[inputIndex + 1], 'utf8')));
  const outIndex = process.argv.indexOf('--out');
  if (outIndex >= 0 && process.argv[outIndex + 1]) fs.writeFileSync(process.argv[outIndex + 1], JSON.stringify(analysis, null, 2) + '\n');
  console.log(JSON.stringify(analysis, null, 2));
}

if (require.main === module) main();

module.exports = { analyzeResult, analyzeReport };
