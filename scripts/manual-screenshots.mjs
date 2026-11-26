// Capturas de docs/manual-empresa.md (fase 13 §6) con los datos ficticios del seed.
// Requiere `pnpm db:start` (con seed) y `pnpm dev`. Uso: node scripts/manual-screenshots.mjs
// En Windows sin Chromium de Playwright: PW_CHANNEL=msedge node scripts/manual-screenshots.mjs
import { mkdirSync } from 'node:fs';
import { chromium, devices } from '@playwright/test';

const DEMO = 'http://demo.localhost:5273';
const OUT = 'docs/manual/img';
const BARBA = '30000000-0000-4000-a000-000000000002';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'es-CO' });
const page = await desktop.newPage();

const shot = async (name, full = false) => {
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 70, fullPage: full });
  console.log(`${OUT}/${name}.jpg`);
};

await page.goto(`${DEMO}/admin/login`);
await shot('01-login');
await page.getByLabel('Correo').fill('owner@demo.local');
await page.getByLabel('Contraseña', { exact: true }).fill('Servigo123!');
await page.getByRole('button', { name: 'Entrar' }).click();
await page.waitForURL(`${DEMO}/admin`);

const pages = [
  ['02-inicio', '/admin'],
  ['03-empresa', '/admin/configuracion/empresa'],
  ['04-sedes', '/admin/sedes'],
  ['05-servicios', '/admin/catalogo/servicios'],
  ['07-formularios', '/admin/formularios'],
  ['08-calendario', '/admin/calendario'],
  ['09-acerca', '/admin/contenido/acerca'],
  ['10-config-reservas', '/admin/configuracion/reservas'],
  ['11-reservas', '/admin/reservas'],
  ['13-clientes', '/admin/clientes'],
  ['14-privacidad', '/admin/contenido/privacidad'],
  ['15-miembros', '/admin/configuracion/miembros'],
];
for (const [name, path] of pages) {
  await page.goto(`${DEMO}${path}`);
  await page.getByRole('heading').first().waitFor();
  await shot(name);
}

// Ficha de un servicio y detalle de una reserva.
await page.goto(`${DEMO}/admin/catalogo/servicios`);
await page
  .getByRole('link', { name: /Corte de cabello/ })
  .first()
  .click();
await page.getByRole('heading').first().waitFor();
await shot('06-ficha-servicio');
await page.goto(`${DEMO}/admin/reservas`);
await page
  .getByRole('button', { name: /^Abrir reserva/ })
  .first()
  .click();
await page.getByRole('dialog').waitFor();
await shot('12-detalle-reserva');

// Sitio público en el celular.
const phone = await browser.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 2, locale: 'es-CO' });
const p = await phone.newPage();
for (const [name, path] of [
  ['20-sitio-inicio', '/'],
  ['21-sitio-sede', '/s/norte'],
  ['22-reservar', `/s/norte/reservar/${BARBA}`],
  ['23-mis-reservas', '/mis-reservas'],
]) {
  await p.goto(`${DEMO}${path}`);
  await p.getByRole('heading').first().waitFor();
  await p.waitForTimeout(800);
  await p.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 70 });
  console.log(`${OUT}/${name}.jpg`);
}

await browser.close();
