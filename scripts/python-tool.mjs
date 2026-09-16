#!/usr/bin/env node
/** Run Python tooling with pinned uv without changing the user's global install. */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
if (!args.length) {
  console.error('Usage: node scripts/python-tool.mjs <python|pywrangler|command> [arguments...]');
  process.exit(2);
}
const root = fileURLToPath(new URL('../', import.meta.url));
const child = spawn(process.env.PIRATES_UV_EXECUTABLE || 'uv', [
  'tool', 'run', '--from', 'uv==0.12.15', 'uv', 'run', '--locked', ...args,
], {
  cwd: root,
  stdio: 'inherit',
  detached: process.platform !== 'win32',
  env: { ...process.env, UV_SYSTEM_PYTHON: 'false' },
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    try {
      // Wrangler creates its own workerd child; stop the complete owned tree.
      if (process.platform === 'win32') child.kill(signal);
      else if (child.pid) process.kill(-child.pid, signal);
    } catch (error) {
      if (error.code !== 'ESRCH') console.error(error.message);
    }
  });
}
child.on('error', (error) => {
  console.error(error.code === 'ENOENT'
    ? 'Python tooling requires uv. Install it from https://docs.astral.sh/uv/getting-started/installation/.'
    : `Could not start Python tooling: ${error.message}`);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1);
});
