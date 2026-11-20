// Writes the public list of recognised platforms (names only) from the engine. Run after changing providers.js.
import { writeFileSync } from 'node:fs';
import { PROVIDERS, KIND_LABEL, KIND_ORDER } from '../../engine/providers.js';
const groups = KIND_ORDER.map((kind) => ({ kind, label: KIND_LABEL[kind], names: PROVIDERS.filter((p) => p.kind === kind).map((p) => p.name) })).filter((g) => g.names.length);
writeFileSync(new URL('../lib/client/platforms.json', import.meta.url), JSON.stringify({ total: PROVIDERS.length, groups }, null, 2) + '\n');
console.log(`Wrote ${PROVIDERS.length} platforms`);
