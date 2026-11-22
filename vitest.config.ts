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
  },
});
