/** Verify the whole embedded library and that no calculation endpoint remains. */
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
const base = process.argv[2];
if (!base) throw new Error('Usage: npm run test:api -- http://localhost:8787');
const manifest = JSON.parse(await readFile(new URL('../src/generated/static-library.json', import.meta.url)));
const response = await fetch(base);
if (!response.ok) throw new Error(`Page: ${response.status}`);
const html = await response.text();
const match = html.match(/<script[^>]*id="static-library"[^>]*>([\s\S]*?)<\/script>/);
if (!match) throw new Error('Missing embedded library');
const library = JSON.parse(match[1]);
if (Object.keys(library).length !== manifest.scenarioCount) throw new Error('Incomplete library');
if (gzipSync(match[1], { level: 9 }).length >= 3_500_000) throw new Error('Embedded library exceeds 3.5 MB');
for (const value of Object.values(library)) {
  if (value.fingerprint !== manifest.fingerprint || value.schema !== 2) throw new Error('Stale data');
  if (value.snapshot.inputs.foreignAiGrowth !== value.snapshot.inputs.usAiGrowth) throw new Error('Mismatched AI growth assumptions');
  if (value.snapshot.statusQuoUnavailable) throw new Error('Removed plurality scenario remains');
  if (!value.snapshot.ballot.coordination) throw new Error('Missing strategic voting result');
  if (!['domestic-ballot', 'verified-consistent', 'selected-by-rule'].includes(value.snapshot.selection)) throw new Error('Missing selected outcome');
  for (const field of ['usPolicy', 'foreignPolicy']) {
    const policy = value.snapshot.selected[field];
    if (policy && (!Number.isFinite(policy.aiProfitTax) || 'capitalTax' in policy)) throw new Error('Stale investment-tax policy');
    if (policy?.pace === 0 && policy.replacement !== 0) throw new Error('Pause AI includes employer retention');
  }
  if (value.snapshot.selected.us.length !== 11) throw new Error('Incomplete income chart');
}
for (const removed of ['id="share"', 'id="grid-link-notice"', 'id="status-quo-unavailable"', 'id="manual-inputs"', 'id="accounting-table"', 'id="ballot-table"'])
  if (html.includes(removed)) throw new Error(`Removed UI remains: ${removed}`);
const oldApi = await fetch(new URL('/api/simulate', base), { method: 'POST', body: '{}' });
if (oldApi.ok) throw new Error('The old calculation endpoint should not run');
console.log(`Embedded delivery verified: ${manifest.scenarioCount} scenarios, ${gzipSync(match[1]).length} gzip bytes, no calculation API.`);
