/** Astro HMR with a local Python Worker; no economic code runs in Node. */
import { build, dev } from 'astro';
import { spawn } from 'node:child_process';
import { existsSync, watch } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const sitePort = Number(process.env.PIRATES_SITE_PORT || 4321);
const apiPort = Number(process.env.PIRATES_API_PORT || 8787);
const children = new Set();
const watchers = [];
let stopping = false;
let timer;
let staging = false;
let queued = false;
let astroServer;
function processCommand(command, args, longRunning = false) {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit' });
  children.add(child);
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      children.delete(child);
      if (longRunning && !stopping) shutdown(code || 0);
      if (code === 0 || stopping) resolve();
      else reject(new Error(`${command} exited with ${code ?? signal}`));
    });
  });
}
const python = (...args) => processCommand(process.execPath, ['scripts/python-tool.mjs', ...args]);
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  clearTimeout(timer);
  for (const watcher of watchers) watcher.close();
  for (const child of children) child.kill('SIGTERM');
  astroServer?.stop().catch(console.error);
  process.exitCode = code;
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => shutdown());
async function restage() {
  if (staging) { queued = true; return; }
  staging = true;
  try {
    await python('python', 'scripts/build-precomputed.py', '--metadata-only');
    await python('python', 'scripts/stage-worker.py', '--dev');
  } catch (error) {
    console.error(error.message);
  } finally {
    staging = false;
    if (queued && !stopping) { queued = false; await restage(); }
  }
}
try {
  for (const port of [sitePort, apiPort]) await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', () => reject(new Error(`Port ${port} is occupied. Set PIRATES_SITE_PORT or PIRATES_API_PORT to use another port.`)));
    probe.listen(port, 'localhost', () => probe.close(resolve));
  });
  await python('python', 'scripts/build-precomputed.py', '--metadata-only');
  // Workers Static Assets requires a directory even while Astro serves the page.
  if (!existsSync(new URL('../dist/index.html', import.meta.url)))
    await build({ root });
  await python('python', 'scripts/stage-worker.py', '--dev');
  for (const directory of ['calculator', 'worker']) {
    watchers.push(watch(new URL(`../${directory}`, import.meta.url), { recursive: true }, (_event, filename) => {
      if (!filename || filename.includes('__pycache__') || filename === '_generated.py' || !/\.(py|json)$/.test(filename)) return;
      clearTimeout(timer);
      timer = setTimeout(restage, 250);
    }));
  }
  astroServer = await dev({ root, server: { host: 'localhost', port: sitePort } });
  console.log(`Astro + Python development: http://localhost:${sitePort}`);
  await processCommand(process.execPath, ['scripts/python-tool.mjs', 'pywrangler', 'dev', '--port', String(apiPort), '--local-upstream', `localhost:${sitePort}`], true);
} catch (error) {
  console.error(error.message);
  shutdown(1);
}
