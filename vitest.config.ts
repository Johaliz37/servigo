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
    // Los tests de componentes declaran `// @vitest-environment jsdom` en el archivo.
    // `pnpm test:coverage` (CI): el módulo de precios exige > 95 % (criterio de la fase 06).
    coverage: {
      provider: 'v8',
      include: ['src/shared/**/*.ts'],
      exclude: ['src/shared/**/*.test.ts', 'src/shared/database.types.ts'],
      reporter: ['text-summary', 'text'],
      thresholds: {
        'src/shared/pricing.ts': { statements: 95, branches: 95, functions: 95, lines: 95 },
      },
    },
  },
});
