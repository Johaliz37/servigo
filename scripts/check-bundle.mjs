// Presupuesto de JS inicial del sitio público (fase 09 §4 y fase 13 §4): ≤ 150 KiB gzip.
// Suma el script de entrada de dist/client/index.html y sus `modulepreload` (lo que el
// navegador baja antes de pintar). Corre tras `pnpm build`.
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const BUDGET = 150 * 1024;
const html = readFileSync('dist/client/index.html', 'utf8');
const files = [...html.matchAll(/<(?:script[^>]+src|link[^>]+rel="modulepreload"[^>]+href)="([^"]+\.js)"/g)].map(
  (m) => m[1],
);
let total = 0;
for (const file of new Set(files)) {
  const size = gzipSync(readFileSync(`dist/client${file}`), { level: 9 }).length;
  total += size;
  console.log(`${(size / 1024).toFixed(1).padStart(7)} KiB  ${file}`);
}
console.log(`${(total / 1024).toFixed(1).padStart(7)} KiB  total (presupuesto ${BUDGET / 1024} KiB)`);
if (total > BUDGET) {
  console.error('El JS inicial supera el presupuesto.');
  process.exit(1);
}
