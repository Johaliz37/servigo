import { defineConfig, devices } from '@playwright/test';

// E2E contra `pnpm dev` + Supabase local con seed. En CI: job `e2e` (fase 13).
export default defineConfig({
  testDir: './e2e',
  // Un solo worker: todas las pruebas comparten la BD con seed (p. ej. fase05 y fase06 tocan la
  // misma sede) y varias pestañas comprimiendo imágenes saturan el servidor de desarrollo.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['github']] : 'list',
  use: {
    baseURL: 'http://demo.localhost:5273',
    trace: 'on-first-retry',
  },
  // Local: `PW_CHANNEL=msedge` usa el Edge instalado en vez de descargar Chromium.
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}) },
    },
    // Flujos públicos en Safari de iPhone (fase 13): las pruebas con la etiqueta @mobile.
    { name: 'mobile-webkit', use: { ...devices['iPhone 13'] }, grep: /@mobile/ },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:5273/api/health',
    reuseExistingServer: !process.env.CI,
  },
});
