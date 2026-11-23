import { expect, test, type Page } from '@playwright/test';

// Criterios de aceptación de la fase 03. Requieren `pnpm db:start` (con seed) y `pnpm dev`.
const PASSWORD = 'Servigo123!';
const MAILPIT = 'http://127.0.0.1:54424';

async function login(page: Page, email: string, password = PASSWORD) {
  await page.getByLabel('Correo').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

/** Último correo enviado a `to` (Mailpit), con reintentos mientras llega. */
async function lastEmailLink(to: string): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const search = (await (
      await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`)
    ).json()) as {
      messages: { ID: string }[];
    };
    const id = search.messages[0]?.ID;
    if (id) {
      const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json()) as { HTML: string };
      const href = /href="([^"]*\/auth\/v1\/verify[^"]*)"/.exec(msg.HTML)?.[1];
      if (href) return href.replace(/&amp;/g, '&');
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No llegó correo a ${to}`);
}

test('cada subdominio muestra su empresa y su color', async ({ page }) => {
  await page.goto('http://demo.localhost:5273/');
  await expect(page.getByRole('heading', { level: 1, name: 'Barbería Demo' })).toBeVisible();
  const demoPrimary = await page.evaluate(() => document.documentElement.style.getPropertyValue('--primary'));
  expect(demoPrimary).toMatch(/^oklch\(/);

  await page.goto('http://spa.localhost:5273/');
  await expect(page.getByRole('heading', { level: 1, name: 'Spa Luna' })).toBeVisible();
  const spaPrimary = await page.evaluate(() => document.documentElement.style.getPropertyValue('--primary'));
  expect(spaPrimary).not.toBe(demoPrimary);
});

test('empresa inexistente → 404 de tenant', async ({ page }) => {
  const res = await page.goto('http://noexiste.localhost:5273/');
  expect(res?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Esta empresa no existe' })).toBeVisible();
});

test('el HTML trae <title> y og:title de la empresa', async ({ page }) => {
  // Desde el navegador: Node no resuelve *.localhost.
  const html = (await (await page.goto('http://demo.localhost:5273/'))?.text()) ?? '';
  expect(html).toContain('<title>Barbería Demo</title>');
  expect(html).toContain('<meta property="og:title" content="Barbería Demo">');
});

test('/admin exige login y un owner de otra empresa no tiene acceso', async ({ page }) => {
  await page.goto('http://demo.localhost:5273/admin/reservas');
  await expect(page).toHaveURL(/\/admin\/login\?next=%2Fadmin%2Freservas$/);
  await login(page, 'owner@spa.local');
  await expect(page.getByText('No tienes acceso a esta empresa')).toBeVisible();
});

test('staff solo ve las secciones de su rol', async ({ page }) => {
  await page.goto('http://demo.localhost:5273/admin/login');
  await login(page, 'staff@demo.local');
  await expect(page.getByRole('link', { name: 'Reservas' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Miembros' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Servicios' })).toHaveCount(0);
});

test('superadmin crea una empresa, el owner acepta la invitación y entra', async ({ page }) => {
  const suffix = Date.now().toString(36);
  const slug = `prueba-${suffix}`;
  const owner = `owner-${suffix}@e2e.local`;

  await page.goto('http://localhost:5273/console');
  await expect(page).toHaveURL(/\/console\/login/);
  await login(page, 'superadmin@servigo.local');
  await expect(page.getByRole('heading', { name: 'Empresas' })).toBeVisible();

  await page.getByRole('button', { name: 'Nueva empresa' }).click();
  await page.getByLabel('Nombre').fill(`Prueba ${suffix}`);
  await page.getByLabel('Subdominio').fill(slug);
  await expect(page.getByText('Disponible', { exact: true })).toBeVisible();
  await page.getByLabel('Subdominio').fill('servigo');
  await expect(page.getByText('Reservado por Servigo o Roquintech')).toBeVisible();
  await page.getByLabel('Subdominio').fill(slug);
  await page.getByLabel('Correo del owner').fill(owner);
  await page.getByRole('button', { name: 'Crear empresa' }).click();
  await expect(page.getByText(`Invitación enviada a ${owner}`)).toBeVisible();
  await expect(page.getByRole('link', { name: `${slug}.localhost` })).toBeVisible();

  // El enlace del correo verifica en Supabase y vuelve al subdominio con la sesión.
  await page.goto(await lastEmailLink(owner));
  await expect(page).toHaveURL(new RegExp(`^http://${slug}\\.localhost:5273/admin/aceptar-invitacion`));
  await expect(page.getByText(`Únete a Prueba ${suffix}`)).toBeVisible();
  await page.getByLabel('Contraseña nueva').fill('Owner-e2e-123');
  await page.getByLabel('Repite la contraseña').fill('Owner-e2e-123');
  await page.getByRole('button', { name: 'Crear contraseña y aceptar' }).click();

  await expect(page).toHaveURL(`http://${slug}.localhost:5273/admin`);
  await expect(page.getByRole('link', { name: 'Miembros' })).toBeVisible();
  await page.getByRole('link', { name: 'Miembros' }).click();
  await expect(page.getByRole('cell', { name: `${owner} (tú)` })).toBeVisible();
});
