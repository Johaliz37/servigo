import { defineConfig, devices } from '@playwright/test';

// E2E contra `pnpm dev` + Supabase local con seed. En CI llegan con la fase 04/09.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
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
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:5273/api/health',
    reuseExistingServer: !process.env.CI,
  },
});
