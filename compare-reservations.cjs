'use strict';

const fs = require('fs');
const { spawn } = require('child_process');

function args(argv) {
  const out = { models: ['gemma4:cloud', 'qwen3.5:cloud'], profile: 'standard', episodes: 1, repeats: 1, seed: 30000, cases: 1, timeoutMs: 60000, maxActions: 12, out: null };
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '');
    if (key === 'models') out.models = String(argv[++i]).split(',').filter(Boolean);
    else if (key === 'profile') out.profile = argv[++i];
    else if (['episodes', 'repeats', 'seed', 'cases', 'timeout-ms', 'max-actions'].includes(key)) out[key === 'timeout-ms' ? 'timeoutMs' : key === 'max-actions' ? 'maxActions' : key] = Number(argv[++i]);
    else if (key === 'out') out.out = argv[++i];
  }
  return out;
}

function runModel(config, model) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['reservations-run.cjs', '--mode', 'ollama', '--model', model, '--profile', config.profile, '--episodes', config.episodes, '--repeats', config.repeats, '--seed', config.seed, '--cases', config.cases, '--timeout-ms', config.timeoutMs, '--max-actions', config.maxActions], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      const marker = stdout.split(/\r?\n/).find(line => line.startsWith('RESERVATIONS_SUMMARY '));
      if (!marker) return reject(new Error(`${model} produced no summary (exit ${code}): ${stderr.trim()}`));
      resolve(JSON.parse(marker.slice('RESERVATIONS_SUMMARY '.length)));
    });
  });
}

async function main() {
  const config = args(process.argv), results = [];
  for (const model of config.models) results.push(await runModel(config, model));
  console.table(results.map(result => ({ model: result.model, accuracy: result.meanAccuracy, score: result.meanScore, episodeSuccess: result.episodeSuccessRate, latencyMs: result.meanLatencyMs, timeouts: result.modelTimeoutRate, toolErrors: result.toolErrorRate, budget: result.budgetExceededRate, passK: result.passK })));
  const report = { config, results };
  console.log(`RESERVATIONS_COMPARE ${JSON.stringify(report)}`);
  if (config.out) fs.writeFileSync(config.out, JSON.stringify(report, null, 2) + '\n');
}

if (require.main === module) main().catch(error => { console.error(`ERROR: ${error.message}`); process.exitCode = 1; });

module.exports = { args };
