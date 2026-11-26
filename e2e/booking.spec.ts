import { expect, test, type APIRequestContext } from '@playwright/test';

// Fase 10: reserva y consulta sin cuenta. Requiere `pnpm db:start` (con seed) y `pnpm dev`.
// Usa la Sede Norte (horario propio M–S 10–18) para no tocar los cupos de Centro (fase 08).
// Turnstile: en local, la clave de prueba siempre valida.
const DEMO = 'http://demo.localhost:5273';
// Node no resuelve *.localhost: la API se llama en el host raíz con `?tenant=demo` (solo local).
const API = 'http://localhost:5273/api';
const T = 'tenant=demo';
const NORTE = '20000000-0000-4000-a000-000000000002';
const BARBA = '30000000-0000-4000-a000-000000000002';
const CERA = '30000000-0000-4000-a000-000000000004';

test.describe.configure({ mode: 'serial' });

// Las pruebas de la API usan otra IP para el rate limit (10 reservas/min): así no agotan el cupo
// de la prueba de UI al repetir la suite. En producción Cloudflare fija esta cabecera.
const apiIp = () => ({
  'cf-connecting-ip': `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
});

/** Teléfono distinto en cada ejecución: la búsqueda solo trae las reservas de esta prueba. */
const randomPhone = () => `300${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

async function slotsFor(request: APIRequestContext, service: string, daysAhead: number) {
  const from = iso(Date.now() + daysAhead * 86_400_000);
  const to = iso(Date.now() + (daysAhead + 6) * 86_400_000);
  const res = await request.get(`${API}/public/slots?${T}&branch=${NORTE}&service=${service}&from=${from}&to=${to}`);
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as { days: { date: string; slots: { start: string }[] }[] };
  return body.days.flatMap((d) => d.slots.map((s) => s.start));
}

const booking = (starts_at: string, extra: Record<string, unknown> = {}) => ({
  branch_slug: 'norte',
  service_id: BARBA,
  starts_at,
  customer: { name: 'Prueba API', phone: `+57${randomPhone()}`, email: '', notes: '' },
  privacy_consent: true,
  turnstile: 'XXXX.DUMMY.TOKEN.XXXX',
  ...extra,
});

test(
  'reserva completa con un complemento y campos adicionales → código → búsqueda por teléfono',
  { tag: '@mobile' },
  async ({ page }) => {
    test.setTimeout(90_000);
    const phone = randomPhone();

    await page.goto(`${DEMO}/s/norte`);
    await page.getByRole('link', { name: 'Reservar Corte de cabello' }).click();
    await expect(page.getByRole('heading', { name: 'Elige fecha y hora' })).toBeVisible();

    // Mes siguiente: lejos de la antelación mínima y de otras pruebas.
    await page
      .getByRole('button', { name: /siguiente|next/i })
      .first()
      .click();
    // Día y hora al azar: repetir la suite no choca con las reservas de la vez anterior.
    const days = page.locator('button[data-day]:not([disabled])');
    await expect(days.first()).toBeVisible();
    await days.nth(Math.floor(Math.random() * Math.min(10, await days.count()))).click();
    const slots = page.locator('button[aria-pressed]');
    await expect(slots.first()).toBeVisible();
    await slots.nth(Math.floor(Math.random() * (await slots.count()))).click();

    // Paso 3: un complemento (Shampoo, sin control de stock).
    await expect(page.getByRole('heading', { name: 'Añade productos' })).toBeVisible();
    await page.getByRole('button', { name: 'Añadir una unidad de Shampoo anticaspa' }).click();
    await expect(page.getByTestId('booking-total').first()).toContainText('60.000');
    await page.getByRole('button', { name: 'Continuar' }).click();

    // Paso 4: datos e información adicional.
    await expect(page.getByRole('heading', { name: 'Tus datos' })).toBeVisible();
    await page.getByLabel('Nombre completo').fill('Laura Gómez');
    await page.getByRole('textbox', { name: 'Teléfono' }).fill(phone);
    await page.getByRole('combobox', { name: '¿Cómo nos conociste?' }).click();
    await page.getByRole('option', { name: 'Un amigo' }).click();
    await page.getByRole('checkbox', { name: /Autorizo a Barbería Demo/ }).check();
    await page.getByRole('button', { name: 'Continuar' }).click();

    // Recargar no pierde lo escrito (sessionStorage + URL).
    await expect(page.getByRole('heading', { name: 'Revisa y confirma' })).toBeVisible();
    await page.reload();
    await expect(page.getByText('Laura Gómez')).toBeVisible();

    // Paso 5: Turnstile y confirmar.
    const confirm = page.getByRole('button', { name: 'Confirmar reserva' });
    await expect(confirm).toBeEnabled({ timeout: 20_000 });
    await confirm.click();
    await expect(page).toHaveURL(/\/reserva\/[0-9A-Z]{8}\?t=/);
    const code = (await page.getByTestId('booking-code').innerText()).trim();
    expect(code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    await expect(page.getByText('Pendiente', { exact: true })).toBeVisible();
    await expect(page.getByTestId('booking-detail-total')).toContainText('60.000');
    await expect(page.getByText('1 × Shampoo anticaspa')).toBeVisible();
    await expect(page.getByText('Un amigo')).toBeVisible();
    await expect(page.getByRole('link', { name: /Google Calendar/ })).toHaveAttribute('href', /calendar\.google\.com/);

    // Búsqueda por teléfono en «Mis reservas».
    await page.goto(`${DEMO}/mis-reservas`);
    await page.getByRole('tab', { name: 'Por teléfono o correo' }).click();
    await page.getByRole('textbox', { name: 'Teléfono' }).fill(phone);
    const search = page.getByRole('button', { name: 'Buscar' });
    await expect(search).toBeEnabled({ timeout: 20_000 });
    await search.click();
    const results = page.getByRole('region', { name: '1 reserva' });
    await expect(results).toContainText(code);
    await expect(results).toContainText('La*** Gó***');

    // Sin el enlace, el detalle pide el contacto.
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());
    await page.goto(`${DEMO}/reserva/${code.replace('-', '')}`);
    await expect(page.getByText('escribe el teléfono o el correo con que reservaste')).toBeVisible();
  },
);

test('API: el mismo cupo pedido dos veces a la vez → una entra y la otra recibe 409', async ({ request }) => {
  const ip = apiIp();
  const slots = await slotsFor(request, BARBA, 40);
  const start = slots.at(-1)!;
  const [a, b] = await Promise.all([
    request.post(`${API}/bookings?${T}`, { headers: ip, data: booking(start) }),
    request.post(`${API}/bookings?${T}`, { headers: ip, data: booking(start) }),
  ]);
  expect([a.status(), b.status()].sort()).toEqual([201, 409]);
  const created = (await (a.status() === 201 ? a : b).json()) as { code: string; token: string };

  // El total que se ve coincide con el guardado (20.000, sin descuentos).
  const detail = await request.get(`${API}/bookings/${created.code}?${T}&t=${encodeURIComponent(created.token)}`);
  expect(((await detail.json()) as { total: number }).total).toBe(20000);
});

test('API: peticiones manipuladas se rechazan', async ({ request }) => {
  const ip = apiIp();
  const slots = await slotsFor(request, BARBA, 47);
  const start = slots[0]!;

  // Hora en el pasado o que no es un cupo.
  const past = await request.post(`${API}/bookings?${T}`, {
    headers: ip,
    data: booking(new Date(Date.now() - 3_600_000).toISOString()),
  });
  expect(past.status()).toBe(409);
  const offGrid = await request.post(`${API}/bookings?${T}`, {
    headers: ip,
    data: booking(new Date(Date.parse(start) + 7 * 60_000).toISOString()),
  });
  expect(offGrid.status()).toBe(409);

  // Producto que no es complemento del servicio (Arreglo de barba no tiene).
  const product = await request.post(`${API}/bookings?${T}`, {
    headers: ip,
    data: booking(start, { items: [{ product_id: CERA, quantity: 1 }] }),
  });
  expect(product.status()).toBe(422);

  // Servicio de otra sede/empresa o inexistente.
  const service = await request.post(`${API}/bookings?${T}`, {
    headers: ip,
    data: booking(start, { service_id: '30000000-0000-4000-a000-000000000011' }),
  });
  expect(service.status()).toBe(404);

  // Teléfono sin formato.
  const badPhone = await request.post(`${API}/bookings?${T}`, {
    headers: ip,
    data: booking(start, { customer: { name: 'X', phone: '3001234567', email: '', notes: '' } }),
  });
  expect(badPhone.status()).toBe(400);

  // Un token de otra reserva no abre el detalle.
  const ok = await request.post(`${API}/bookings?${T}`, { headers: ip, data: booking(start) });
  expect(ok.status()).toBe(201);
  const { code } = (await ok.json()) as { code: string };
  const forged = await request.get(`${API}/bookings/${code}?${T}&t=9999999999.${'A'.repeat(43)}`);
  expect(forged.status()).toBe(404);
});

test('si el horario se ocupó al confirmar, vuelve a la fecha con aviso y conserva los datos', async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  const ip = apiIp();
  const slots = await slotsFor(request, BARBA, 33);
  const start = slots[Math.floor(Math.random() * slots.length)]!;
  // Alguien toma el cupo por la API…
  const taken = await request.post(`${API}/bookings?${T}`, { headers: ip, data: booking(start) });
  expect(taken.status()).toBe(201);

  // …mientras esta persona tenía la URL del asistente con ese horario (estado en la URL).
  const date = start.slice(0, 10);
  await page.goto(`${DEMO}/s/norte/reservar/${BARBA}?step=datos&date=${date}&slot=${encodeURIComponent(start)}`);
  await page.getByLabel('Nombre completo').fill('Carlos Ruiz');
  await page.getByRole('textbox', { name: 'Teléfono' }).fill(randomPhone());
  await page.getByRole('checkbox', { name: /Autorizo a Barbería Demo/ }).check();
  await page.getByRole('button', { name: 'Continuar' }).click();
  const confirm = page.getByRole('button', { name: 'Confirmar reserva' });
  await expect(confirm).toBeEnabled({ timeout: 20_000 });
  await confirm.click();

  await expect(page.getByRole('heading', { name: 'Elige fecha y hora' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Ese horario se acaba de ocupar');
  await expect(page).not.toHaveURL(/slot=/);
  // Elegir otra hora lleva directo a «Tus datos» con lo escrito.
  await page.locator('button[aria-pressed]').first().click();
  await expect(page.getByLabel('Nombre completo')).toHaveValue('Carlos Ruiz');
});
