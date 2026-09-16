import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const sourceDir = resolve(root, 'src/lib/economy');
const sources = (await readdir(sourceDir)).filter(name =>
  (name.endsWith('.ts') || name === 'us-electorate-data.json') &&
  !name.endsWith('.test.ts') && name !== 'simulation.worker.ts').sort();
const hash = createHash('sha256');
for (const name of sources) hash.update(name).update(await readFile(resolve(sourceDir, name)));
hash.update(await readFile(fileURLToPath(import.meta.url)));
const fingerprint = hash.digest('hex').slice(0, 20);
const bundled = await build({
  stdin: { contents: "export {solveScenario} from './src/lib/economy/simulation.ts'; export {DEFAULT_INPUTS} from './src/lib/economy/pirates-model.ts'; export {scenarioKey,PRECOMPUTED_SCHEMA_VERSION} from './src/lib/economy/precomputed.ts';", resolveDir: root },
  bundle: true, platform: 'node', format: 'esm', write: false,
});
const {solveScenario, DEFAULT_INPUTS, scenarioKey, PRECOMPUTED_SCHEMA_VERSION} =
  await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const output = resolve(root, 'public/precomputed');
await mkdir(output, { recursive: true });
const scenarios = {};
const liveFiles = new Set();
const cases = [
  { name: 'default', inputs: DEFAULT_INPUTS },
  { name: 'all-roles-obsolete', inputs: {...DEFAULT_INPUTS, productivityGain: .5, displacement: 1, reemployment: 0} },
];
for (const item of cases) for (const mode of ['us-only','strategic']) {
  for (const foreignObjective of mode === 'us-only' ? ['workers'] : ['workers','prosperity','output']) {
    const request = { id: 0, inputs: item.inputs, mode, foreignObjective };
    const key = scenarioKey(request);
    const filename = fingerprint + '-' + createHash('sha256').update(key).digest('hex').slice(0,16) + '.json';
    const start = performance.now();
    const snapshot = solveScenario(request);
    if (scenarioKey(snapshot) !== key) throw new Error('Precomputed inputs do not match the request.');
    if (snapshot.ballot.winnerId && !snapshot.selected.usAdmissible) throw new Error('Unfunded ballot winner.');
    const data = { schemaVersion: PRECOMPUTED_SCHEMA_VERSION, fingerprint, key, snapshot };
    await writeFile(resolve(output, filename), JSON.stringify(data, (_key, value) =>
      ArrayBuffer.isView(value) ? Array.from(value) : value) + '\n');
    scenarios[key] = '/precomputed/' + filename;
    liveFiles.add(filename);
    console.log(item.name, mode, foreignObjective, snapshot.selection, (performance.now()-start).toFixed(0)+'ms');
  }
}
await writeFile(resolve(sourceDir, 'precomputed-index.json'), JSON.stringify({
  schemaVersion: PRECOMPUTED_SCHEMA_VERSION, fingerprint, scenarios,
}, null, 2) + '\n');
// This directory contains only generated scenario assets.
for (const name of await readdir(output)) if (/^[a-f0-9]+-[a-f0-9]+\.json$/.test(name) && !liveFiles.has(name)) {
  await rm(resolve(output, name));
}
console.log('Generated ' + Object.keys(scenarios).length + ' exact common scenarios; other inputs calculate in the browser.');
