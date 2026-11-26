import { expect, test, type Page } from '@playwright/test';

// Fase 09: sitio público. Requiere `pnpm db:start` (con seed) y `pnpm dev`.
// demo = 2 sedes (Centro con 3 servicios, 2 patrocinadores y las redes de la empresa);
// spa = 1 sede.
const DEMO = 'http://demo.localhost:5273';
const SPA = 'http://spa.localhost:5273';
const CORTE = '30000000-0000-4000-a000-000000000001';

test.describe.configure({ mode: 'serial' });

/** Posición vertical de cada sección marcada con `data-section`, en orden de aparición. */
async function sectionOrder(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-section]')]
      .map((el) => ({ name: el.dataset.section!, top: el.getBoundingClientRect().top + window.scrollY }))
      .sort((a, b) => a.top - b.top)
      .map((s) => s.name),
  );
}

test('empresa con 2 sedes: elige sede y ve 3.1 → 3.5 en orden', { tag: '@mobile' }, async ({ page }) => {
  await page.goto(`${DEMO}/`);
  await expect(page.getByRole('heading', { level: 1, name: 'Barbería Demo' })).toBeVisible();
  const cards = page.getByRole('region', { name: 'Elige tu sede' }).getByRole('link');
  await expect(cards).toHaveCount(2);

  await page
    .getByRole('link', { name: /Sede Centro/ })
    .first()
    .click();
  await expect(page).toHaveURL(`${DEMO}/s/centro`);

  // 3.1 Encabezado
  await expect(page.getByRole('heading', { level: 1, name: 'Sede Centro' })).toBeVisible();
  await expect(page.getByText('Lunes a sábado')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Reservar', exact: true })).toHaveAttribute('href', '/s/centro/reservar');
  // 3.2 Carrusel con los 3 servicios
  const carousel = page.getByRole('region', { name: 'Carrusel de servicios' });
  await expect(carousel.getByRole('group', { name: /de 3:/ })).toHaveCount(3);
  await expect(carousel.getByRole('heading', { name: 'Corte de cabello' })).toBeVisible();
  // 3.3 Patrocinadores, 3.4 redes (heredadas de la empresa), 3.5 footer
  await expect(page.getByRole('region', { name: 'Patrocinadores' }).getByRole('listitem')).toHaveCount(2);
  const socials = page.getByRole('region', { name: 'Síguenos' });
  await expect(socials.getByRole('link', { name: 'Instagram' })).toHaveAttribute(
    'href',
    'https://instagram.com/barberiademo',
  );
  await expect(page.getByRole('contentinfo')).toContainText('Hecho con Servigo');

  expect(await sectionOrder(page)).toEqual(['header', 'services', 'products', 'sponsors', 'socials', 'footer']);

  // El inicio recuerda la última sede.
  await page.getByRole('link', { name: 'Barbería Demo' }).first().click();
  await expect(page.getByRole('link', { name: 'Continuar en Sede Centro' })).toBeVisible();

  // Selector de sede del header.
  await page.getByRole('button', { name: /cambiar de sede/ }).click();
  await page
    .getByRole('banner')
    .getByRole('link', { name: /Sede Norte/ })
    .click();
  await expect(page).toHaveURL(`${DEMO}/s/norte`);
  // Norte tiene redes propias (seed): reemplazan a las de la empresa.
  await expect(page.getByRole('region', { name: 'Síguenos' }).getByRole('link')).toHaveCount(1);
  // Norte no tiene patrocinadores: la sección no aparece.
  await expect(page.getByRole('region', { name: 'Patrocinadores' })).toHaveCount(0);
});

test('empresa con 1 sede entra directo', { tag: '@mobile' }, async ({ page }) => {
  await page.goto(`${SPA}/`);
  await expect(page).toHaveURL(`${SPA}/s/principal`);
  await expect(page.getByRole('heading', { level: 1, name: 'Spa Luna' })).toBeVisible();
  // Sin selector de sede con una sola.
  await expect(page.getByRole('button', { name: /cambiar de sede/ })).toHaveCount(0);
  // Descuento vigente: precio final, base tachado y fecha límite.
  const masaje = page
    .getByRole('region', { name: 'Servicios' })
    .getByRole('article')
    .filter({ hasText: 'Masaje relajante' });
  await expect(masaje).toContainText('$ 102.000');
  await expect(masaje).toContainText('−15 % · Hasta el');
});

test('ficha de servicio: detalles, complementos y meta para compartir', { tag: '@mobile' }, async ({ page }) => {
  await page.goto(`${DEMO}/s/centro`);
  await page
    .getByRole('region', { name: 'Servicios' })
    .getByRole('link', { name: /^Corte de cabello/ })
    .click();
  await expect(page).toHaveURL(`${DEMO}/s/centro/servicios/${CORTE}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Corte de cabello' })).toBeVisible();
  await expect(page.getByRole('term').filter({ hasText: 'Incluye' })).toBeVisible();
  const addons = page.getByRole('region', { name: 'Complementos' });
  await expect(addons.getByRole('link')).toHaveCount(2);
  await expect(page).toHaveTitle('Corte de cabello · Barbería Demo');

  // El HTML que recibe WhatsApp ya trae el título del servicio (HTMLRewriter).
  const html = (await (await page.goto(`${DEMO}/s/centro/servicios/${CORTE}`))?.text()) ?? '';
  expect(html).toContain('<meta property="og:title" content="Corte de cabello · Barbería Demo">');
  expect(html).toContain('<meta property="og:description" content="Corte a tijera o máquina">');

  // Ruta con el tipo equivocado o sede inexistente → 404.
  const wrong = await page.goto(`${DEMO}/s/centro/productos/${CORTE}`);
  expect(wrong?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Este producto no está disponible' })).toBeVisible();
  const missing = await page.goto(`${DEMO}/s/no-existe`);
  expect(missing?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Esta sede no existe' })).toBeVisible();
});

test('«Acerca de», robots.txt y sitemap.xml', async ({ page }) => {
  await page.goto(`${DEMO}/`);
  await page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Acerca de' }).click();
  // El texto lo edita la E2E de la fase 05: basta con que la sección visible aparezca.
  await expect(page.getByRole('heading', { level: 1, name: 'Acerca de Barbería Demo' })).toBeVisible();
  await expect(page.getByRole('main').getByRole('region')).toHaveCount(1);

  const robots = (await (await page.goto(`${DEMO}/robots.txt`))?.text()) ?? '';
  expect(robots).toContain(`Sitemap: ${DEMO}/sitemap.xml`);
  const sitemap = (await (await page.goto(`${DEMO}/sitemap.xml`))?.text()) ?? '';
  expect(sitemap).toContain(`${DEMO}/s/norte`);
  expect(sitemap).toContain(`${DEMO}/s/centro/servicios/${CORTE}`);
});

test('ocultar un patrocinador en el panel: un visitante nuevo lo deja de ver al instante (purga)', async ({
  page,
  browser,
}) => {
  /** Visitante sin sesión ni caché del navegador: lo que ve sale de la caché del edge. */
  const visitorSponsors = async () => {
    const context = await browser.newContext();
    const visitor = await context.newPage();
    await visitor.goto(`${DEMO}/s/centro`);
    await expect(visitor.getByRole('heading', { level: 1, name: 'Sede Centro' })).toBeVisible();
    const names = await visitor.getByRole('region', { name: 'Patrocinadores' }).getByRole('listitem').allInnerTexts();
    await context.close();
    // La tarjeta sin logo muestra la inicial antes del nombre.
    return names.map((n) => n.trim().split('\n').pop()!.trim());
  };

  // Primera visita: la sede queda en la caché pública (60 s).
  expect(await visitorSponsors()).toEqual(['Navajas Pro', 'Café del Barrio']);

  await page.goto(`${DEMO}/admin/login`);
  await page.getByLabel('Correo').fill('owner@demo.local');
  await page.getByLabel('Contraseña', { exact: true }).fill('Servigo123!');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(`${DEMO}/admin`);

  const setVisible = async (visible: boolean) => {
    await page.goto(`${DEMO}/admin/contenido/patrocinadores`);
    const toggle = page.getByRole('switch', { name: 'Navajas Pro visible' });
    await expect(toggle).toBeVisible();
    if ((await toggle.isChecked()) !== visible) {
      const purge = page.waitForResponse((r) => r.url().endsWith('/api/admin/purge-public'));
      await toggle.click();
      expect((await purge).status()).toBe(204);
    }
  };

  try {
    await setVisible(false);
    // Sin purga seguiría saliendo durante 60 s.
    expect(await visitorSponsors()).toEqual(['Café del Barrio']);
  } finally {
    await setVisible(true);
  }
  expect(await visitorSponsors()).toEqual(['Navajas Pro', 'Café del Barrio']);
});
