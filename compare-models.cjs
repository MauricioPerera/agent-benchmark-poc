'use strict';

const { execFileSync } = require('child_process');

function args(argv) {
  const out = { profile: 'standard', episodes: 1, repeats: 1, seed: 18000, cases: 1, difficulty: 5, timeoutMs: 60000, maxActions: 40, models: ['gemma4:cloud', 'qwen3.5:cloud'] };
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '');
    if (key === 'models') out.models = argv[++i].split(',').map(x => x.trim()).filter(Boolean);
    else if (['profile','episodes','repeats','seed','cases','difficulty','timeout-ms','max-actions'].includes(key)) out[key === 'timeout-ms' ? 'timeoutMs' : key] = argv[++i];
  }
  for (const key of ['episodes','repeats','seed','cases','difficulty','timeoutMs','maxActions']) out[key] = Number(out[key]);
  return out;
}

function main() {
  const config = args(process.argv), results = [];
  for (const model of config.models) {
    const parameters = ['run.cjs', '--mode', 'ollama', '--model', model, '--profile', config.profile, '--episodes', config.episodes, '--repeats', config.repeats, '--seed', config.seed, '--cases', config.cases, '--difficulty', config.difficulty, '--max-actions', config.maxActions, '--timeout-ms', config.timeoutMs, '--summary-only'];
    try {
      const output = execFileSync(process.execPath, parameters, { encoding: 'utf8', timeout: Math.max(120000, config.timeoutMs * config.episodes * config.repeats * 2), maxBuffer: 16 * 1024 * 1024 });
      const line = output.split(/\r?\n/).find(value => value.startsWith('BENCHMARK_SUMMARY '));
      if (!line) throw new Error('summary marker missing');
      results.push(JSON.parse(line.slice('BENCHMARK_SUMMARY '.length)));
    } catch (error) { results.push({ model, profile: config.profile, error: error.message }); }
  }
  console.table(results.map(row => ({ model: row.model, accuracy: row.meanAccuracy, passK: row.passK, critical: row.criticalErrors, latencyMs: row.meanLatencyMs, error: row.error || '' })));
  console.log(JSON.stringify({ comparison: 'puesto7-agent-benchmark-poc', config, results }, null, 2));
}

main();
