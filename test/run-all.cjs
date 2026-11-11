'use strict';

// Discover release tests instead of maintaining an increasingly stale list.
// Each suite has its own process, clock and Homey mocks. Continue after a
// failure so one old fixture cannot hide failures in later release tests.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawn, spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const filter = process.argv.find(arg => arg.startsWith('--filter='))?.slice(9) || '';
const timeoutMs = Math.max(1000, Number(process.env.HOMEFLUX_TEST_TIMEOUT_MS) || 300000);
const concurrency = Math.max(1, Math.min(4, Number(process.env.HOMEFLUX_TEST_CONCURRENCY) || 2));
const suites = fs.readdirSync(__dirname)
  .filter(name => name.endsWith('.test.js') || name === 'status-request-coalescing-1.2.38.cjs')
  .filter(name => !filter || name.includes(filter))
  .sort();

function sourceFiles(dir = root) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (['node_modules', '.homeybuild', '.git'].includes(entry.name)) return [];
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : [file];
  });
}

function checkSyntax() {
  const counts = { javascript: 0, inlineScripts: 0, json: 0 };
  for (const file of sourceFiles().sort()) {
    const extension = path.extname(file);
    if (['.js', '.cjs', '.mjs'].includes(extension)) {
      const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
      if (result.status !== 0) throw new Error(`${path.relative(root, file)}\n${result.stderr || result.stdout}`);
      counts.javascript++;
    } else if (extension === '.json') {
      JSON.parse(fs.readFileSync(file, 'utf8'));
      counts.json++;
    } else if (extension === '.html') {
      const html = fs.readFileSync(file, 'utf8');
      for (const [, attributes, code] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
        if (/\bsrc\s*=/.test(attributes) || /\btype\s*=/.test(attributes) && !/javascript/.test(attributes)) continue;
        new vm.Script(code, { filename: path.relative(root, file) });
        counts.inlineScripts++;
      }
    }
  }
  console.log('Syntax/JSON checks passed:', JSON.stringify(counts));
}

function runSuite(name) {
  return new Promise(resolve => {
    const started = Date.now();
    const child = spawn(process.execPath, [path.join(__dirname, name)], {
      cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '', timedOut = false, spawnError = null, forceTimer;
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    child.on('error', error => { spawnError = error; });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      forceTimer = setTimeout(() => child.kill('SIGKILL'), 1000);
    }, timeoutMs);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      clearTimeout(forceTimer);
      const pass = code === 0 && !timedOut && !spawnError;
      const result = { name, pass, code, signal, timedOut, seconds: (Date.now() - started) / 1000 };
      console.log(`[${pass ? 'PASS' : timedOut ? 'TIMEOUT' : 'FAIL'}] ${name} (${result.seconds.toFixed(2)} s)`);
      if (output.trim()) console.log(output.trim());
      if (spawnError) console.error(spawnError.message);
      resolve(result);
    });
  });
}

async function main() {
  if (process.argv.includes('--check')) checkSyntax();
  if (!suites.length) throw new Error(`No release test suites match ${JSON.stringify(filter)}`);
  console.log(`Running ${suites.length} release suites with ${process.version}; concurrency ${concurrency}; timeout ${timeoutMs / 1000} s.`);
  const results = new Array(suites.length);
  let cursor = 0;
  async function worker() {
    while (cursor < suites.length) {
      const index = cursor++;
      results[index] = await runSuite(suites[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, suites.length) }, worker));
  const failed = results.filter(result => !result.pass);
  console.log(`Release tests: ${results.length - failed.length}/${results.length} passed; ${failed.length} failed.`);
  for (const result of failed) console.error(`- ${result.name}${result.timedOut ? ' (timeout)' : ''}`);
  if (failed.length) process.exitCode = 1;
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
