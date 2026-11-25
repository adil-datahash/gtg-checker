// Writes files the website needs from the engine. Run after changing engine/providers.js or engine/probe.js:
//   lib/client/platforms.json  the public list of recognised platforms (names only)
//   lib/client/probe.json      the "check from your browser" script, with __REPORT_URL__ filled in on the page
import { writeFileSync } from 'node:fs';
import { PROVIDERS, KIND_LABEL, KIND_ORDER } from '../../engine/providers.js';
import { visitorProbeScript, PROBE_VERSION } from '../../engine/probe.js';

const groups = KIND_ORDER.map((kind) => ({ kind, label: KIND_LABEL[kind], names: PROVIDERS.filter((p) => p.kind === kind).map((p) => p.name) })).filter((g) => g.names.length);
writeFileSync(new URL('../lib/client/platforms.json', import.meta.url), JSON.stringify({ total: PROVIDERS.length, groups }, null, 2) + '\n');
console.log(`Wrote ${PROVIDERS.length} platforms`);

// Written from the unbundled engine source, so the website's own build never rewrites it.
const source = visitorProbeScript('__REPORT_URL__');
writeFileSync(new URL('../lib/client/probe.json', import.meta.url), JSON.stringify({ version: PROBE_VERSION, source }) + '\n');
console.log(`Wrote the browser check script (${source.length} characters)`);
