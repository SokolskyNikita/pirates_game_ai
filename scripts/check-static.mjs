/** Smoke-check the published static delivery contract. */
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
const base = process.argv[2];
if (!base) throw new Error('Usage: npm run test:api -- http://localhost:8787');
const manifest = JSON.parse(await readFile(new URL('../src/generated/static-library.json', import.meta.url)));
for (const path of ['/', ...Object.values(manifest.paths).filter((_, i) => i % 97 === 0)]) {
  const response = await fetch(new URL(path, base));
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  if (path !== '/') {
    const bytes = Buffer.from(await response.arrayBuffer());
    const value = JSON.parse((bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes).toString());
    if (value.fingerprint !== manifest.fingerprint || value.schema !== 1) throw new Error('Stale static data');
  }
}
const oldApi = await fetch(new URL('/api/simulate', base), { method: 'POST', body: '{}' });
if (oldApi.ok) throw new Error('The old calculation endpoint should not run');
console.log(`Static delivery verified; ${manifest.scenarioCount} scenarios indexed; no calculation API.`);
