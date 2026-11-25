import { readFile } from 'node:fs/promises';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

// Criterios de aceptación de la fase 11 (gestión de reservas). Requieren `pnpm db:start` (con
// seed) y `pnpm dev`. Las reservas se crean en la Sede Norte (staff@demo.local solo ve Centro),
// en días y horas al azar para poder repetir la suite.
const DEMO = 'http://demo.localhost:5273';
const API = 'http://localhost:5273/api';
const T = 'tenant=demo';
const NORTE = '20000000-0000-4000-a000-000000000002';
const BARBA = '30000000-0000-4000-a000-000000000002';

test.describe.configure({ mode: 'serial' });

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const randomPhone = () => `+57300${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
const apiIp = () => ({
  'cf-connecting-ip': `10.1.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
});

async function login(page: Page, email = 'owner@demo.local') {
  await page.goto(`${DEMO}/admin/login`);
  await page.getByLabel('Correo').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill('Servigo123!');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(`${DEMO}/admin`);
}

/** Reserva web en Norte por la API pública (como un cliente), en un cupo al azar. */
async function webBooking(request: APIRequestContext, name: string, daysAhead = 20 + Math.floor(Math.random() * 25)) {
  const from = iso(Date.now() + daysAhead * 86_400_000);
  const to = iso(Date.now() + (daysAhead + 6) * 86_400_000);
  const slots = await request.get(`${API}/public/slots?${T}&branch=${NORTE}&service=${BARBA}&from=${from}&to=${to}`);
  const days = ((await slots.json()) as { days: { slots: { start: string }[] }[] }).days.flatMap((d) => d.slots);
  for (let attempt = 0; attempt < 5; attempt++) {
    const start = days[Math.floor(Math.random() * days.length)]!.start;
    const res = await request.post(`${API}/bookings?${T}`, {
      headers: apiIp(),
      data: {
        branch_slug: 'norte',
        service_id: BARBA,
        starts_at: start,
        customer: { name, phone: randomPhone(), email: '', notes: '' },
        turnstile: 'XXXX.DUMMY.TOKEN.XXXX',
      },
    });
    if (res.status() === 201) return { ...((await res.json()) as { code: string }), start };
  }
  throw new Error('No se pudo crear la reserva de prueba');
}

const formatted = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

test('una reserva web aparece en la bandeja sin recargar y se gestiona con historial', async ({ page, request }) => {
  test.setTimeout(90_000);
  await login(page);
  await page.goto(`${DEMO}/admin/reservas?tab=pending&sede=${NORTE}`);
  await expect(page.getByRole('heading', { name: 'Reservas' })).toBeVisible();
  // Dar tiempo a que el canal de Realtime quede suscrito.
  await page.waitForTimeout(1500);

  const name = `Realtime ${Math.floor(Math.random() * 1e6)}`;
  const { code } = await webBooking(request, name);

  // Aviso en vivo y fila nueva, sin recargar.
  await expect(page.getByText(`Nueva reserva ${formatted(code)}`)).toBeVisible({ timeout: 15_000 });
  await page.getByRole('searchbox', { name: /Buscar por código/ }).fill(code);
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();
  await expect(page.getByRole('button', { name: `Abrir reserva ${formatted(code)}` })).toBeVisible();

  // Detalle → confirmar → cancelar con motivo; el historial guarda quién lo hizo.
  await page.getByRole('button', { name: `Abrir reserva ${formatted(code)}` }).click();
  const sheet = page.getByRole('dialog', { name: 'Reserva' });
  await expect(sheet.getByTestId('detail-code')).toHaveText(formatted(code));
  await expect(sheet.getByRole('button', { name: 'Completar' })).toHaveCount(0); // futura y pendiente
  await sheet.getByRole('button', { name: 'Confirmar' }).click();
  await expect(sheet.getByText('Confirmada', { exact: true }).first()).toBeVisible();
  const history = sheet.getByRole('region', { name: 'Historial' });
  await expect(history).toContainText('Confirmada');
  await expect(history).toContainText('owner@demo.local');

  // Notas internas.
  await sheet.getByRole('textbox', { name: 'Notas internas' }).fill('Prefiere a Juan');
  await sheet.getByRole('button', { name: 'Guardar notas' }).click();
  await expect(page.getByText('Notas guardadas')).toBeVisible();

  // Reprogramar con el motor de cupos.
  await sheet.getByRole('button', { name: 'Reprogramar' }).click();
  const dialog = page.getByRole('dialog', { name: 'Reprogramar' });
  const days = dialog.locator('button[data-day]:not([disabled])');
  await expect(days.first()).toBeVisible();
  await days.nth(Math.floor(Math.random() * Math.min(8, await days.count()))).click();
  await dialog.locator('button[aria-pressed]').first().click();
  await dialog.getByRole('button', { name: /^Mover al/ }).click();
  await expect(page.getByText(/^Reserva movida al/)).toBeVisible();
  await expect(history).toContainText('Reprogramada');

  await sheet.getByRole('button', { name: 'Cancelar', exact: true }).click();
  const cancel = page.getByRole('dialog', { name: /^Cancelar/ });
  await cancel.getByLabel('Motivo (opcional)').fill('El cliente avisó');
  await cancel.getByRole('button', { name: 'Cancelar reserva' }).click();
  await expect(history).toContainText('Cancelada: «El cliente avisó»');
  // Estado final: ya no hay transiciones.
  await expect(sheet.getByRole('button', { name: 'Confirmar' })).toHaveCount(0);
});

test('exportar CSV respeta los filtros', async ({ page, request }) => {
  const name = `Csv ${Math.floor(Math.random() * 1e6)}`;
  const { code } = await webBooking(request, name);
  await login(page);
  await page.goto(`${DEMO}/admin/reservas?tab=all&q=${encodeURIComponent(name)}`);
  await expect(page.getByRole('button', { name: `Abrir reserva ${formatted(code)}` })).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar CSV' }).click();
  const file = await (await download).path();
  const csv = (await readFile(file, 'utf8')).replace(/^\uFEFF/, '');
  const lines = csv.trim().split('\r\n');
  expect(lines[0]).toMatch(/^Código,Fecha,Hora,Sede,Servicio,Cliente/);
  expect(lines).toHaveLength(2);
  expect(lines[1]).toContain(formatted(code));
  expect(lines[1]).toContain(name);
});

test('reserva manual desde el panel (origen admin)', async ({ page }) => {
  test.setTimeout(60_000);
  await login(page);
  await page.goto(`${DEMO}/admin/reservas/nueva`);
  await page.locator('#nb-branch').click();
  await page.getByRole('option', { name: 'Sede Norte' }).click();
  await page.getByLabel('Servicio').click();
  await page.getByRole('option', { name: /^Arreglo de barba/ }).click();

  // Mes siguiente y un día/hora al azar.
  await page
    .getByRole('button', { name: /siguiente|next/i })
    .first()
    .click();
  const days = page.locator('button[data-day]:not([disabled])');
  await expect(days.first()).toBeVisible();
  await days.nth(Math.floor(Math.random() * Math.min(12, await days.count()))).click();
  const slots = page.locator('button[aria-pressed]');
  await expect(slots.first()).toBeVisible();
  await slots.nth(Math.floor(Math.random() * (await slots.count()))).click();

  const name = `Manual ${Math.floor(Math.random() * 1e6)}`;
  await page.getByLabel('Nombre completo').fill(name);
  await page.getByRole('textbox', { name: 'Teléfono' }).fill(randomPhone().slice(3));
  await page.getByRole('button', { name: 'Crear reserva' }).click();

  await expect(page).toHaveURL(/\/admin\/reservas\?b=/);
  const sheet = page.getByRole('dialog', { name: 'Reserva' });
  await expect(sheet.getByText('Creada en el panel')).toBeVisible();
  await expect(sheet.getByText('Confirmada', { exact: true }).first()).toBeVisible();
  await expect(sheet.getByRole('region', { name: 'Historial' })).toContainText('Reserva creada desde el panel');
});

test('staff de la sede Centro no ve ni gestiona reservas de Norte', async ({ page, request }) => {
  const name = `Aislada ${Math.floor(Math.random() * 1e6)}`;
  const { code } = await webBooking(request, name);

  // El owner la ve…
  await login(page);
  await page.goto(`${DEMO}/admin/reservas?tab=all&q=${code}`);
  const link = page.getByRole('button', { name: `Abrir reserva ${formatted(code)}` });
  await expect(link).toBeVisible();
  await link.click();
  const id = new URL(page.url()).searchParams.get('b');
  expect(id).toBeTruthy();

  // …staff (solo Centro) no: ni en la bandeja ni por enlace directo (RLS).
  await page.context().clearCookies();
  await page.evaluate(() => localStorage.clear());
  await login(page, 'staff@demo.local');
  await page.goto(`${DEMO}/admin/reservas?tab=all&q=${code}`);
  await expect(page.getByText('No hay reservas con estos filtros.')).toBeVisible();
  await page.goto(`${DEMO}/admin/reservas/${id}`);
  await expect(page.getByText('La reserva no existe o no tienes acceso a ella.')).toBeVisible();
});

test('calendario: clic abre el detalle y arrastrar una reserva la reprograma', async ({ page, request }) => {
  test.setTimeout(60_000);
  const name = `Arrastre ${Math.floor(Math.random() * 1e6)}`;
  const { code, start } = await webBooking(request, name);
  // Fecha local de Bogotá (UTC−5, sin horario de verano).
  const date = iso(Date.parse(start) - 5 * 3_600_000);
  await login(page);
  await page.goto(`${DEMO}/admin/calendario?sede=${NORTE}&fecha=${date}`);
  await expect(page.getByTestId('calendar-title')).not.toBeEmpty();
  await page.keyboard.press('d'); // vista Día (atajo, como Google Calendar)

  const event = page.locator('.sv-ev-booking', { hasText: name });
  await expect(event).toBeVisible();
  await event.click();
  const sheet = page.getByRole('dialog', { name: 'Reserva' });
  await expect(sheet.getByTestId('detail-code')).toHaveText(formatted(code));
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();

  await expect(event).toHaveClass(/fc-event-draggable/);
  // Arrastrar 1 h (dos franjas de 30 min) hacia abajo o hacia arriba según la hora.
  const hour = new Date(Date.parse(start) - 5 * 3_600_000).getUTCHours();
  const box = (await event.boundingBox())!;
  const lane = (await page.locator('.fc-timegrid-slot-lane').first().boundingBox())!;
  const dy = (hour >= 16 ? -2 : 2) * lane.height;
  await page.mouse.move(box.x + box.width / 2, box.y + 5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 5 + dy / 2, { steps: 5 });
  await page.mouse.move(box.x + box.width / 2, box.y + 5 + dy, { steps: 5 });
  await page.mouse.up();

  const dialog = page.getByRole('dialog', { name: '¿Reprogramar la reserva?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Ese horario (está disponible|está lleno)/)).toBeVisible();
  if (await dialog.getByText('Ese horario está disponible.').isVisible()) {
    await dialog.getByRole('button', { name: 'Reprogramar' }).click();
  } else {
    await dialog.getByLabel('Forzar fuera de disponibilidad').check();
    await dialog.getByRole('button', { name: 'Reprogramar' }).click();
  }
  await expect(page.getByText(/^Reserva movida al/)).toBeVisible();
  await event.click();
  await expect(sheet.getByRole('region', { name: 'Historial' })).toContainText('Reprogramada');
});
