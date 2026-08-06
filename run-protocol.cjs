'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function parseArgs(argv) {
  const out = { config: 'evaluation-protocol.json', out: 'results/protocol-report.json', dryRun: false, models: null, suites: null, episodes: null, repeats: null };
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '');
    if (key === 'dry-run') out.dryRun = true;
    else if (key === 'models') out.models = String(argv[++i]).split(',').filter(Boolean);
    else if (key === 'suites') out.suites = String(argv[++i]).split(',').filter(Boolean);
    else if (['config', 'out'].includes(key)) out[key] = argv[++i];
    else if (['episodes', 'repeats'].includes(key)) out[key] = Number(argv[++i]);
  }
  return out;
}

function commandFor(suite, model) {
  const common = ['--mode', 'ollama', '--model', model, '--episodes', String(suite.episodes), '--repeats', String(suite.repeats), '--seed', String(suite.seed), '--timeout-ms', String(suite.timeoutMs), '--max-actions', String(suite.maxActions)];
  if (suite.domain === 'border') return ['run.cjs', ...common, '--cases', String(suite.cases), '--profile', suite.profile, '--summary-only'];
  if (suite.domain === 'support') return ['support-run.cjs', ...common];
  if (suite.domain === 'reservations') return ['reservations-run.cjs', ...common, '--cases', String(suite.cases), '--profile', suite.profile];
  throw new Error(`unsupported domain: ${suite.domain}`);
}

function summaryMarker(domain) {
  return domain === 'border' ? 'BENCHMARK_SUMMARY ' : domain === 'support' ? 'SUPPORT_SUMMARY ' : 'RESERVATIONS_SUMMARY ';
}

function runCommand(args, domain) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      const marker = stdout.split(/\r?\n/).find(line => line.startsWith(summaryMarker(domain)));
      if (!marker) return reject(new Error(`${args[0]} exited ${code} without ${summaryMarker(domain).trim()}: ${stderr.trim()}`));
      resolve(JSON.parse(marker.slice(summaryMarker(domain).length)));
    });
  });
}

async function main() {
  const options = parseArgs(process.argv);
  const protocol = JSON.parse(fs.readFileSync(options.config, 'utf8'));
  const models = options.models || protocol.models;
  const suites = options.suites ? protocol.suites.filter(suite => options.suites.includes(suite.id)) : protocol.suites;
  if (!suites.length) throw new Error('no suites selected');
  const unknownSuites = options.suites?.filter(id => !protocol.suites.some(suite => suite.id === id)) || [];
  if (unknownSuites.length) throw new Error(`unknown suite(s): ${unknownSuites.join(', ')}`);
  const effectiveSuites = suites.map(suite => ({ ...suite, ...(options.episodes ? { episodes: options.episodes } : {}), ...(options.repeats ? { repeats: options.repeats } : {}) }));
  const plan = effectiveSuites.flatMap(suite => models.map(model => ({ suite: suite.id, model, command: commandFor(suite, model) })));
  if (options.dryRun) return console.log(JSON.stringify({ version: protocol.version, jobs: plan }, null, 2));
  const results = [];
  const report = { version: protocol.version, protocol, options, results: [] };
  for (const suite of effectiveSuites) for (const model of models) {
    const command = commandFor(suite, model);
    console.log(`RUN ${suite.id} model=${model}`);
    const item = { suite: suite.id, domain: suite.domain, model, summary: await runCommand(command, suite.domain) };
    results.push(item); report.results = results;
    fs.mkdirSync(path.dirname(options.out), { recursive: true });
    fs.writeFileSync(options.out, JSON.stringify(report, null, 2) + '\n');
  }
  report.results = results;
  fs.writeFileSync(options.out, JSON.stringify(report, null, 2) + '\n');
  console.log(`PROTOCOL_REPORT ${JSON.stringify({ output: options.out, results: results.length })}`);
}

if (require.main === module) main().catch(error => { console.error(`ERROR: ${error.message}`); process.exitCode = 1; });

module.exports = { parseArgs, commandFor };
