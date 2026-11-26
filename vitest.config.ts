import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

// Config propia (sin el plugin de Cloudflare) para tests unitarios rápidos.
export default defineConfig({
  resolve: {
    alias: {
      '@client': fileURLToPath(new URL('./src/client', import.meta.url)),
      '@worker': fileURLToPath(new URL('./src/worker', import.meta.url)),
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
    // La instrumentación de cobertura encarece el motor de cupos: su presupuesto de tiempo
    // (fase08.test.ts) se mide sin cobertura en `pnpm test` y con holgura en `pnpm test:coverage`.
    env: { PERF_BUDGET_MS: process.argv.includes('--coverage') ? '10' : '5' },
    // Los tests de componentes declaran `// @vitest-environment jsdom` en el archivo.
    // `pnpm test:coverage` (CI). Mínimos de la fase 13: `src/shared` ≥ 90 % y total ≥ 70 %
    // (lógica testeable: shared + Worker; la UI se cubre con E2E). Precios > 95 % (fase 06).
    coverage: {
      provider: 'v8',
      include: ['src/shared/**/*.ts', 'src/worker/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/shared/database.types.ts'],
      reporter: ['text-summary', 'text'],
      thresholds: {
        statements: 70,
        branches: 70,
        functions: 70,
        lines: 70,
        'src/shared/**/*.ts': { statements: 90, branches: 80, functions: 90, lines: 90 },
        'src/shared/pricing.ts': { statements: 95, branches: 95, functions: 95, lines: 95 },
      },
    },
  },
});
