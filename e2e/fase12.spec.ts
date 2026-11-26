import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

// Criterios de aceptación de la fase 12 (dashboard). Requieren `pnpm db:start` (con seed) y
// `pnpm dev`. Usa un rango futuro personalizado y una reserva web creada por la API pública.
const DEMO = 'http://demo.localhost:5273';
const API = 'http://localhost:5273/api';
const T = 'tenant=demo';
const NORTE = '20000000-0000-4000-a000-000000000002';
const BARBA = '30000000-0000-4000-a000-000000000002';

test.describe.configure({ mode: 'serial' });

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const SHOTS = process.env.DASHBOARD_SHOTS;

async function login(page: Page, email = 'owner@demo.local') {
  await page.goto(`${DEMO}/admin/login`);
  await page.getByLabel('Correo').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill('Servigo123!');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(`${DEMO}/admin`);
}

async function webBooking(request: APIRequestContext, from: string, to: string) {
  const res = await request.get(`${API}/public/slots?${T}&branch=${NORTE}&service=${BARBA}&from=${from}&to=${to}`);
  const slots = ((await res.json()) as { days: { slots: { start: string }[] }[] }).days.flatMap((d) => d.slots);
  for (let i = 0; i < 5; i++) {
    const start = slots[Math.floor(Math.random() * slots.length)]!.start;
    const r = await request.post(`${API}/bookings?${T}`, {
      headers: { 'cf-connecting-ip': `10.2.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
      data: {
        branch_slug: 'norte',
        service_id: BARBA,
        starts_at: start,
        customer: {
          name: 'Dashboard',
          phone: `+57300${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`,
          email: '',
          notes: '',
        },
        privacy_consent: true,
        turnstile: 'XXXX.DUMMY.TOKEN.XXXX',
      },
    });
    if (r.status() === 201) return;
  }
  throw new Error('No se pudo crear la reserva');
}

test('KPIs, gráficas y actualización en vivo al llegar una reserva', async ({ page, request }) => {
  test.setTimeout(90_000);
  const from = iso(Date.now() - 7 * 86_400_000);
  const to = iso(Date.now() + 40 * 86_400_000);
  await login(page);
  await page.goto(`${DEMO}/admin?rango=custom&desde=${from}&hasta=${to}`);

  const kpi = page.getByTestId('kpi-Reservas');
  await expect(kpi).toHaveText(/^\d+$/);
  const before = Number(await kpi.innerText());
  await expect(page.getByTestId('kpi-Ingresos esperados')).toBeVisible();
  await expect(page.getByTestId('kpi-Ocupación')).toHaveText(/%|—/);
  // Serie con Recharts (chunk diferido) y comparación entre sedes para el owner.
  await expect(page.locator('.recharts-surface').first()).toBeVisible();
  await expect(page.getByText('Comparación entre sedes')).toBeVisible();

  // «Ver tabla» muestra los valores en texto.
  const services = page.locator('[data-slot="card"]', { hasText: 'Servicios más reservados' });
  await services.getByRole('button', { name: 'Ver tabla' }).click();
  await expect(services.getByRole('columnheader', { name: 'Reservas' })).toBeVisible();

  if (SHOTS) await page.screenshot({ path: `${SHOTS}/dashboard-owner.png`, fullPage: true });

  await page.waitForTimeout(1500); // canal de Realtime suscrito
  await webBooking(request, iso(Date.now() + 10 * 86_400_000), iso(Date.now() + 30 * 86_400_000));
  await expect(kpi).toHaveText(String(before + 1), { timeout: 15_000 });
});

test('staff: solo su sede, sin comparación entre sedes', async ({ page }) => {
  await login(page, 'staff@demo.local');
  await page.goto(`${DEMO}/admin?rango=30d`);
  await expect(page.getByTestId('kpi-Reservas')).toHaveText(/^\d+$/);
  await expect(page.getByText('Servicios más reservados')).toBeVisible();
  await expect(page.getByText('Comparación entre sedes')).toHaveCount(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/dashboard-staff.png`, fullPage: true });
});

test('rango «Hoy» y listas del día', async ({ page }) => {
  await login(page);
  await page.goto(`${DEMO}/admin`);
  await page.getByRole('button', { name: 'Hoy', exact: true }).click();
  await expect(page).toHaveURL(/rango=today/);
  await expect(page.getByRole('button', { name: 'Hoy', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Próximas de hoy')).toBeVisible();
  await expect(page.getByText('Pendientes por confirmar')).toBeVisible();
});
