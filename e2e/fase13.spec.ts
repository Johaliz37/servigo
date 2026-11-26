import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

// Fase 13: seguridad (CSP sin violaciones, aislamiento entre empresas), concurrencia de
// reservas, accesibilidad (axe), teclado, privacidad y anonimización. Requiere `pnpm db:start`
// (con seed) y `pnpm dev`.
const DEMO = 'http://demo.localhost:5273';
const SPA = 'http://spa.localhost:5273';
const API = 'http://localhost:5273/api';
const T = 'tenant=demo';
const DEMO_ID = '10000000-0000-4000-a000-000000000001';
const NORTE = '20000000-0000-4000-a000-000000000002';
const BARBA = '30000000-0000-4000-a000-000000000002';
const CORTE = '30000000-0000-4000-a000-000000000001';

test.describe.configure({ mode: 'serial' });

/** Clave pública y URL de Supabase local (las mismas que usa la SPA). */
function supabaseEnv() {
  const env = Object.fromEntries(
    readFileSync('.env.local', 'utf8')
      .split(/\r?\n/)
      .filter((l) => /^\w+=/.test(l))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
  );
  return { url: env.VITE_SUPABASE_URL!, key: env.VITE_SUPABASE_PUBLISHABLE_KEY! };
}

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const ip = () => `10.13.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
const phone = () => `+57300${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;

async function login(page: Page, origin: string, email: string) {
  await page.goto(`${origin}/admin/login`);
  await page.getByLabel('Correo').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill('Servigo123!');
  await page.getByRole('button', { name: 'Entrar' }).click();
}

/** Errores de CSP y de consola durante la prueba (no deben aparecer). */
function watchConsole(page: Page) {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && /Content Security Policy|Refused to/i.test(m.text())) problems.push(m.text());
  });
  page.on('request', (r) => {
    if (r.url().includes('/api/client-errors') && /"kind":"csp"/.test(r.postData() ?? '')) {
      problems.push(r.postData()!);
    }
  });
  return problems;
}

/** Contenido pintado (Turnstile y Realtime nunca dejan la red quieta: sin `networkidle`). */
async function settled(page: Page) {
  await page.getByRole('heading').first().waitFor();
  await page
    .locator('[aria-busy="true"]')
    .first()
    .waitFor({ state: 'detached', timeout: 10_000 })
    .catch(() => undefined);
  await page.waitForTimeout(400);
}

async function axe(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
}

async function slots(request: APIRequestContext, fromDays: number, toDays: number) {
  const res = await request.get(
    `${API}/public/slots?${T}&branch=${NORTE}&service=${BARBA}&from=${iso(Date.now() + fromDays * 86_400_000)}&to=${iso(Date.now() + toDays * 86_400_000)}`,
  );
  return ((await res.json()) as { days: { slots: { start: string }[] }[] }).days.flatMap((d) =>
    d.slots.map((s) => s.start),
  );
}

const bookingBody = (starts_at: string, extra: Record<string, unknown> = {}) => ({
  branch_slug: 'norte',
  service_id: BARBA,
  starts_at,
  customer: { name: 'Fase Trece', phone: phone(), email: '', notes: '' },
  privacy_consent: true,
  turnstile: 'XXXX.DUMMY.TOKEN.XXXX',
  ...extra,
});

// ---------------------------------------------------------------------------
// Seguridad
// ---------------------------------------------------------------------------

test('cabeceras: CSP con nonce en el HTML y cerrada en la API', async ({ request }) => {
  const html = await request.get(`${API.replace('/api', '')}/?${T}`);
  const csp = html.headers()['content-security-policy']!;
  const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
  expect(nonce).toBeTruthy();
  const body = await html.text();
  expect(body).toContain(`<script nonce="${nonce}">window.__TENANT__=`);
  expect(csp).not.toContain('unsafe-eval');
  expect(html.headers()['x-frame-options']).toBe('DENY');
  expect(html.headers()['referrer-policy']).toBe('strict-origin-when-cross-origin');
  const api = await request.get(`${API}/health`);
  expect(api.headers()['content-security-policy']).toBe("default-src 'none'; frame-ancestors 'none'");
  expect(api.headers()['x-content-type-options']).toBe('nosniff');
});

test('aislamiento: el owner de Spa no lee ni escribe datos de Demo, ni entra a su panel', async ({ page }) => {
  const { url, key } = supabaseEnv();
  await login(page, SPA, 'owner@spa.local');
  await expect(page).toHaveURL(`${SPA}/admin`);

  // Con su propio JWT, directo contra PostgREST (lo mismo que haría desde la consola).
  const result = await page.evaluate(
    async ({ url, key, demo }) => {
      const tokenKey = Object.keys(localStorage).find((k) => k.endsWith('-auth-token'))!;
      const jwt = (JSON.parse(localStorage.getItem(tokenKey)!) as { access_token: string }).access_token;
      const headers = { apikey: key, authorization: `Bearer ${jwt}`, 'content-type': 'application/json' };
      const read = async (table: string) =>
        ((await (await fetch(`${url}/rest/v1/${table}?company_id=eq.${demo}&select=id`, { headers })).json()) as [])
          .length;
      const patch = await fetch(`${url}/rest/v1/companies?id=eq.${demo}`, {
        method: 'PATCH',
        headers: { ...headers, prefer: 'return=representation' },
        body: JSON.stringify({ name: 'Hackeada' }),
      });
      const insert = await fetch(`${url}/rest/v1/catalog_items`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ company_id: demo, kind: 'product', name: 'Intruso', price: 1 }),
      });
      const rpc = await fetch(`${url}/rest/v1/rpc/dashboard_kpis`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          p_company: demo,
          p_branch: null,
          p_from: '2026-01-01T00:00:00Z',
          p_to: '2027-01-01T00:00:00Z',
        }),
      });
      return {
        bookings: await read('bookings'),
        customers: await read('customers'),
        branches: await read('branches'),
        patched: ((await patch.json()) as []).length,
        insert: insert.status,
        rpc: rpc.status,
      };
    },
    { url, key, demo: DEMO_ID },
  );
  expect(result).toEqual({ bookings: 0, customers: 0, branches: 0, patched: 0, insert: 403, rpc: 403 });

  // Su sesión es de spa.localhost (D12); en demo.localhost tiene que entrar y no es miembro.
  await login(page, DEMO, 'owner@spa.local');
  await expect(page.getByText('No tienes acceso a esta empresa')).toBeVisible();
});

test('concurrencia: 20 reservas a la vez al mismo cupo de capacidad 1 → exactamente 1', async ({ request }) => {
  const all = await slots(request, 45, 52);
  const start = all[Math.floor(Math.random() * all.length)]!;
  const responses = await Promise.all(
    Array.from({ length: 20 }, () =>
      request.post(`${API}/bookings?${T}`, { headers: { 'cf-connecting-ip': ip() }, data: bookingBody(start) }),
    ),
  );
  const statuses = responses.map((r) => r.status()).sort();
  expect(statuses.filter((s) => s === 201)).toHaveLength(1);
  expect(statuses.filter((s) => s === 409)).toHaveLength(19);
});

test('rate limit: desde una IP, la 6.ª búsqueda y la 11.ª reserva en un minuto → 429', async ({ request }) => {
  // Carga ligera (fase 13 §1): mismas reglas que en producción (D28), con el binding local.
  const lookupIp = { 'cf-connecting-ip': ip() };
  const lookups = [];
  for (let i = 0; i < 7; i++) {
    lookups.push(
      (
        await request.post(`${API}/bookings/lookup?${T}`, {
          headers: lookupIp,
          data: { mode: 'contact', contact: { phone: phone() }, turnstile: 'XXXX.DUMMY.TOKEN.XXXX' },
        })
      ).status(),
    );
  }
  expect(lookups.slice(0, 5).every((s) => s === 200)).toBe(true);
  expect(lookups.slice(5)).toEqual([429, 429]);

  // Crear: el límite corta antes de validar nada (cuerpo vacío → 400 hasta el 10.º, luego 429).
  const createIp = { 'cf-connecting-ip': ip() };
  const creates = await Promise.all(
    Array.from({ length: 12 }, () => request.post(`${API}/bookings?${T}`, { headers: createIp, data: {} })),
  );
  const codes = creates.map((r) => r.status());
  expect(codes.filter((s) => s === 400)).toHaveLength(10);
  expect(codes.filter((s) => s === 429)).toHaveLength(2);
});

test('la reserva web exige la autorización de datos', async ({ request }) => {
  const all = await slots(request, 38, 44);
  expect(all.length).toBeGreaterThan(0);
  const res = await request.post(`${API}/bookings?${T}`, {
    headers: { 'cf-connecting-ip': ip() },
    data: bookingBody(all[0]!, { privacy_consent: false }),
  });
  expect(res.status()).toBe(400);
  expect(((await res.json()) as { message: string }).message).toMatch(/autorizar el tratamiento/);
});

// ---------------------------------------------------------------------------
// Accesibilidad y CSP en las páginas principales
// ---------------------------------------------------------------------------

const PUBLIC_PAGES = [
  '/',
  '/s/norte',
  `/s/centro/servicios/${CORTE}`,
  '/acerca',
  '/privacidad',
  '/mis-reservas',
  `/s/norte/reservar/${BARBA}`,
];

test('sitio público: 0 violaciones serias de axe y ninguna de la CSP', { tag: '@mobile' }, async ({ page }) => {
  test.setTimeout(120_000);
  const csp = watchConsole(page);
  const found: string[] = [];
  for (const path of PUBLIC_PAGES) {
    await page.goto(`${DEMO}${path}`);
    await settled(page);
    for (const v of await axe(page)) found.push(`${path} → ${v}`);
  }
  await page.goto('http://localhost:5273/');
  await settled(page);
  for (const v of await axe(page)) found.push(`plataforma → ${v}`);
  expect(found).toEqual([]);
  expect(csp).toEqual([]);
});

const ADMIN_PAGES = [
  '/admin',
  '/admin/reservas',
  '/admin/calendario',
  '/admin/clientes',
  '/admin/catalogo/servicios',
  '/admin/formularios',
  '/admin/contenido/privacidad',
  '/admin/configuracion/reservas',
];

test('panel: 0 violaciones serias de axe y ninguna de la CSP', async ({ page }) => {
  test.setTimeout(120_000);
  const csp = watchConsole(page);
  await login(page, DEMO, 'owner@demo.local');
  await expect(page).toHaveURL(`${DEMO}/admin`);
  const found: string[] = [];
  for (const path of ADMIN_PAGES) {
    await page.goto(`${DEMO}${path}`);
    await settled(page);
    for (const v of await axe(page)) found.push(`${path} → ${v}`);
  }
  expect(found).toEqual([]);
  expect(csp).toEqual([]);
});

// ---------------------------------------------------------------------------
// Teclado
// ---------------------------------------------------------------------------

/** Enfoca y activa con el teclado (sin clics). */
async function press(page: Page, locator: ReturnType<Page['locator']>, key = 'Enter') {
  await locator.focus();
  await expect(locator).toBeFocused();
  await page.keyboard.press(key);
}

test('asistente de reserva completo solo con el teclado', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(`${DEMO}/s/norte/reservar/${BARBA}`);
  await expect(page.getByRole('heading', { name: 'Elige fecha y hora' })).toBeVisible();

  await press(page, page.getByRole('button', { name: /siguiente|next/i }).first());
  const days = page.locator('button[data-day]:not([disabled])');
  await expect(days.first()).toBeVisible();
  // Flechas dentro del mes (react-day-picker) y Enter para elegir.
  await days.first().focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  const slot = page.locator('button[aria-pressed]');
  await expect(slot.first()).toBeVisible();
  await press(page, slot.nth(Math.floor(Math.random() * (await slot.count()))));

  // Barba no tiene complementos: del horario se pasa directo a los datos.
  await expect(page.getByRole('heading', { name: 'Tus datos' })).toBeVisible();
  await page.getByLabel('Nombre completo').focus();
  await page.keyboard.type('Teclado Pérez');
  await page.getByRole('textbox', { name: 'Teléfono' }).focus();
  await page.keyboard.type(phone().slice(3));
  await press(page, page.getByRole('combobox', { name: '¿Cómo nos conociste?' }));
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await press(page, page.getByRole('checkbox', { name: /Autorizo a Barbería Demo/ }), 'Space');
  await expect(page.getByRole('checkbox', { name: /Autorizo/ })).toBeChecked();
  await press(page, page.getByRole('button', { name: 'Continuar' }));

  await expect(page.getByRole('heading', { name: 'Revisa y confirma' })).toBeVisible();
  const confirm = page.getByRole('button', { name: 'Confirmar reserva' });
  await expect(confirm).toBeEnabled({ timeout: 20_000 });
  await press(page, confirm);
  await expect(page).toHaveURL(/\/reserva\/[0-9A-Z]{8}\?t=/);
});

test('sin autorizar los datos no se avanza del paso «Tus datos»', { tag: '@mobile' }, async ({ page }) => {
  await page.goto(`${DEMO}/s/norte/reservar/${BARBA}?step=fecha`);
  await page
    .getByRole('button', { name: /siguiente|next/i })
    .first()
    .click();
  await page.locator('button[data-day]:not([disabled])').first().click();
  await page.locator('button[aria-pressed]').first().click();
  await page.getByLabel('Nombre completo').fill('Sin Permiso');
  await page.getByRole('textbox', { name: 'Teléfono' }).fill(phone().slice(3));
  await page.getByRole('combobox', { name: '¿Cómo nos conociste?' }).click();
  await page.getByRole('option').first().click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByText('Debes autorizar el tratamiento de tus datos para reservar')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Leer la política de privacidad' })).toHaveAttribute(
    'href',
    '/privacidad',
  );
});

test('calendario: atajos de vista y eventos que se abren con Enter', async ({ page }) => {
  await login(page, DEMO, 'owner@demo.local');
  await page.goto(`${DEMO}/admin/calendario`);
  await expect(page.locator('.fc')).toBeVisible();
  await page.keyboard.press('m');
  await expect(page.locator('.fc-dayGridMonth-view')).toBeVisible();
  await page.keyboard.press('w');
  await expect(page.locator('.fc-timeGridWeek-view')).toBeVisible();
  await page.keyboard.press('t');

  const event = page.locator('.fc-event[tabindex="0"]').first();
  await expect(event).toBeVisible();
  await event.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog').or(page.locator('[data-slot="popover-content"]')).first()).toBeVisible();
  await page.keyboard.press('Escape');
});

// ---------------------------------------------------------------------------
// Privacidad y derecho de supresión
// ---------------------------------------------------------------------------

test('política: plantilla en el sitio, edición en el panel y enlace en el pie', async ({ page, browser }) => {
  /** Lo que ve un visitante nuevo (sin la caché de 60 s del navegador del editor, D27). */
  async function visitor(check: (p: Page) => Promise<void>) {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await p.goto(`${DEMO}/`);
    await p.getByRole('link', { name: 'Política de privacidad' }).click();
    await expect(p).toHaveURL(`${DEMO}/privacidad`);
    await check(p);
    await ctx.close();
  }

  await login(page, DEMO, 'owner@demo.local');
  await page.goto(`${DEMO}/admin/contenido/privacidad`);
  const text = page.getByRole('textbox', { name: 'Texto de la política' });
  await expect(text).toBeVisible();
  // Si una ejecución anterior quedó a medias, vuelve a la plantilla.
  const reset = page.getByRole('button', { name: 'Volver a la plantilla' });
  if (await reset.isVisible()) {
    await reset.click();
    await expect(page.getByText('Ahora se usa la plantilla')).toBeVisible();
  }
  await expect(page.getByText('Estás usando la plantilla')).toBeVisible();
  await visitor(async (p) => {
    await expect(p.getByRole('heading', { name: 'Responsable del tratamiento' })).toBeVisible();
    await expect(p.getByText('Barbería Demo').first()).toBeVisible();
  });

  await text.fill('## Política propia\n\nTratamos tus datos con cuidado.');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Política guardada')).toBeVisible();
  await visitor(async (p) => {
    await expect(p.getByRole('heading', { name: 'Política propia' })).toBeVisible();
  });

  // Deja el seed como estaba.
  await page.getByRole('button', { name: 'Volver a la plantilla' }).click();
  await expect(page.getByText('Ahora se usa la plantilla')).toBeVisible();
});

test('el owner elimina los datos personales de un cliente a petición', async ({ page, request }) => {
  const all = await slots(request, 30, 37);
  expect(all.length).toBeGreaterThan(0);
  const name = `Borrar ${Math.floor(Math.random() * 1e6)}`;
  const res = await request.post(`${API}/bookings?${T}`, {
    headers: { 'cf-connecting-ip': ip() },
    data: bookingBody(all[Math.floor(Math.random() * all.length)]!, {
      customer: { name, phone: phone(), email: 'borrar@ejemplo.co', notes: 'Alergia' },
    }),
  });
  expect(res.status()).toBe(201);

  await login(page, DEMO, 'owner@demo.local');
  await page.goto(`${DEMO}/admin/clientes?q=${encodeURIComponent(name)}`);
  await page.getByRole('button', { name }).click();
  await page.getByRole('button', { name: `Eliminar datos de ${name}` }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Eliminar datos' }).click();
  await expect(page.getByText('Datos personales eliminados', { exact: true }).first()).toBeVisible();

  await page.goto(`${DEMO}/admin/clientes?q=${encodeURIComponent(name)}`);
  await expect(page.getByText('No hay clientes con esa búsqueda')).toBeVisible();
});
