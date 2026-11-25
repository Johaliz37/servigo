import { expect, test, type Page } from '@playwright/test';

// Criterios de aceptación de la fase 05. Requieren `pnpm db:start` (con seed) y `pnpm dev`.
const PASSWORD = 'Servigo123!';
const DEMO = 'http://demo.localhost:5273';

// En serie: varias pestañas comprimiendo imágenes a la vez saturan el servidor de desarrollo.
test.describe.configure({ mode: 'serial' });

async function login(page: Page, email: string) {
  await page.goto(`${DEMO}/admin/login`);
  await page.getByLabel('Correo').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(`${DEMO}/admin`);
}

/** PNG grande (≈ 2000 × 1500) generado en el navegador: obliga a recortar y comprimir. */
async function makePng(page: Page, seed: number): Promise<Buffer> {
  const dataUrl = await page.evaluate((s) => {
    const canvas = document.createElement('canvas');
    canvas.width = 2000;
    canvas.height = 1500;
    const ctx = canvas.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 2000, 1500);
    g.addColorStop(0, `hsl(${s * 47} 70% 50%)`);
    g.addColorStop(1, `hsl(${s * 47 + 120} 70% 40%)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 2000, 1500);
    let x = s;
    for (let i = 0; i < 4000; i++) {
      x = (x * 9301 + 49297) % 233280;
      ctx.fillStyle = `hsla(${x % 360} 80% 60% / 0.5)`;
      ctx.fillRect((x * 7) % 2000, (x * 13) % 1500, 8 + (x % 40), 8 + (x % 30));
    }
    return canvas.toDataURL('image/png');
  }, seed);
  return Buffer.from(dataUrl.split(',')[1]!, 'base64');
}

/** Sube una imagen por el input de un ImageUploader y confirma el recorte. */
async function uploadImage(page: Page, label: string, seed: number) {
  const png = await makePng(page, seed);
  await page.locator(`input[type=file][aria-label="${label}"]`).setInputFiles({
    name: `e2e-${seed}.png`,
    mimeType: 'image/png',
    buffer: png,
  });
  const dialog = page.getByRole('dialog', { name: new RegExp(`Recortar ${label}`, 'i') });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Usar imagen', exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
}

test('perfil: color y logo se reflejan en el panel y en el sitio público; la imagen pesa ≤ 400 KB y la reemplazada se borra', async ({
  page,
  request,
}) => {
  await login(page, 'owner@demo.local');
  await page.getByRole('link', { name: 'Empresa' }).click();
  await expect(page.getByRole('heading', { name: 'Empresa', level: 1 })).toBeVisible();

  const before = await page.evaluate(() => document.documentElement.style.getPropertyValue('--primary'));
  // Siempre un color distinto del guardado, para que la prueba se pueda repetir.
  const colorInput = page.getByLabel('Color primario', { exact: true });
  const next = (await colorInput.inputValue()).toUpperCase() === '#7A1F5C' ? '#1F5C7A' : '#7A1F5C';
  await colorInput.fill(next);
  await uploadImage(page, 'Logo', 1);
  const logo = page.getByRole('img', { name: 'Logo' });
  await expect(logo).toBeVisible();
  const firstUrl = (await logo.getAttribute('src'))!;

  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByText('Cambios guardados')).toBeVisible();

  // Panel: la marca se aplica sin recargar.
  await expect
    .poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--primary')))
    .not.toBe(before);
  const adminPrimary = await page.evaluate(() => document.documentElement.style.getPropertyValue('--primary'));

  // Imagen optimizada: WebP de 400 KB o menos.
  const img = await request.get(firstUrl);
  expect(img.status()).toBe(200);
  expect(img.headers()['content-type']).toContain('image/webp');
  expect((await img.body()).byteLength).toBeLessThanOrEqual(400 * 1024);

  // Sitio público: mismo color y el logo nuevo (la caché del tenant se purgó al guardar).
  const site = await page.context().newPage();
  await site.goto(`${DEMO}/`);
  await expect(site.locator('header img')).toHaveAttribute('src', firstUrl);
  expect(await site.evaluate(() => document.documentElement.style.getPropertyValue('--primary'))).toBe(adminPrimary);
  await site.close();

  // Reemplazar el logo borra el archivo anterior (y su miniatura).
  await uploadImage(page, 'Logo', 2);
  await expect(logo).not.toHaveAttribute('src', firstUrl);
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByText('Cambios guardados')).toBeVisible();
  await expect.poll(async () => (await request.get(firstUrl)).status()).not.toBe(200);
});

test('sedes: dos sedes con portada, ordenadas por arrastre (teclado) y persistidas', async ({ page }) => {
  await login(page, 'owner@demo.local');
  await page.goto(`${DEMO}/admin/sedes`);
  const names = () => page.getByTestId('branch-card').locator('p.font-medium').allTextContents();

  for (const [i, name] of ['Sede E2E A', 'Sede E2E B'].entries()) {
    await page.getByRole('button', { name: 'Nueva sede' }).click();
    const sheet = page.getByRole('dialog', { name: 'Nueva sede' });
    await sheet.getByLabel('Nombre', { exact: true }).fill(name);
    await expect(sheet.getByLabel('Dirección en el sitio')).toHaveValue(
      name === 'Sede E2E A' ? 'sede-e2e-a' : 'sede-e2e-b',
    );
    await sheet.getByLabel('Ciudad').fill('Medellín');
    await uploadImage(page, 'Portada', 10 + i);
    await sheet.getByRole('button', { name: 'Guardar sede' }).click();
    await expect(page.getByText(`${name} guardada`)).toBeVisible();
  }

  await expect.poll(names).toEqual(['Sede Centro', 'Sede Norte', 'Sede E2E A', 'Sede E2E B']);
  // Las dos nuevas tienen portada distinta.
  const covers = page.getByTestId('branch-card').locator('img');
  await expect(covers).toHaveCount(2);
  const [coverA, coverB] = await covers.evaluateAll((els) => els.map((e) => e.getAttribute('src')));
  expect(coverA).not.toBe(coverB);

  // Arrastre con teclado: tomar B, subirla dos puestos y soltar.
  // dnd-kit mide posiciones entre teclas: una pausa corta entre cada una.
  await page.getByRole('button', { name: 'Mover Sede E2E B' }).focus();
  for (const key of ['Space', 'ArrowUp', 'ArrowUp', 'Space']) {
    await page.keyboard.press(key);
    await page.waitForTimeout(250);
  }
  await expect.poll(names).toEqual(['Sede Centro', 'Sede E2E B', 'Sede Norte', 'Sede E2E A']);

  await page.reload();
  await expect.poll(names).toEqual(['Sede Centro', 'Sede E2E B', 'Sede Norte', 'Sede E2E A']);

  // Sedes sin reservas se pueden borrar.
  for (const name of ['Sede E2E A', 'Sede E2E B']) {
    await page.getByRole('button', { name: `Acciones de ${name}` }).click();
    await page.getByRole('menuitem', { name: 'Borrar' }).click();
    await page.getByRole('button', { name: 'Borrar sede' }).click();
    await expect(page.getByText(`${name} borrada`)).toBeVisible();
  }
  await expect.poll(names).toEqual(['Sede Centro', 'Sede Norte']);
});

test('sedes: no se puede inactivar la última activa ni borrar una sede con reservas', async ({ page }) => {
  await login(page, 'owner@demo.local');
  await page.goto(`${DEMO}/admin/sedes`);
  await page.getByRole('switch', { name: 'Sede Norte activa' }).click();
  await expect(page.getByText('Sede Norte inactivada')).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Sede Centro activa' })).toBeDisabled();

  await page.getByRole('button', { name: 'Acciones de Sede Norte' }).click();
  await page.getByRole('menuitem', { name: 'Borrar' }).click();
  await expect(page.getByRole('alertdialog', { name: 'Sede Norte tiene reservas' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancelar' }).click();

  await page.getByRole('switch', { name: 'Sede Norte activa' }).click();
  await expect(page.getByText('Sede Norte activada')).toBeVisible();
});

test('acerca de: la general visible y la de una sede oculta se guardan por separado', async ({ page }) => {
  await login(page, 'owner@demo.local');
  await page.goto(`${DEMO}/admin/contenido/acerca`);

  const general = page.getByRole('tabpanel', { name: 'General' });
  await general.getByLabel('Título').fill('Nuestra historia');
  await general.getByLabel('Texto').fill('## Desde 2010\n\nCortes con **estilo**.');
  const generalVisible = general.getByRole('switch', { name: 'Visible para clientes' });
  if (!(await generalVisible.isChecked())) await generalVisible.click();
  await general.getByRole('button', { name: 'Vista previa' }).click();
  await expect(general.getByRole('heading', { name: 'Desde 2010' })).toBeVisible();
  await general.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Guardado y visible en el sitio')).toBeVisible();

  await page.getByRole('tab', { name: 'Sede Norte' }).click();
  const norte = page.getByRole('tabpanel', { name: 'Sede Norte' });
  const visible = norte.getByRole('switch', { name: 'Visible para clientes' });
  if (await visible.isChecked()) await visible.click();
  await norte.getByLabel('Título').fill('Sede Norte');
  await norte.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Guardado (oculto para los clientes)')).toBeVisible();

  await page.reload();
  await expect(
    page.getByRole('tabpanel', { name: 'General' }).getByRole('switch', { name: 'Visible para clientes' }),
  ).toBeChecked();
  await page.getByRole('tab', { name: 'Sede Norte' }).click();
  await expect(
    page.getByRole('tabpanel', { name: 'Sede Norte' }).getByRole('switch', { name: 'Visible para clientes' }),
  ).not.toBeChecked();
});

test('redes: herencia empresa → sede y normalización de WhatsApp; patrocinadores ocultos', async ({ page }) => {
  await login(page, 'owner@demo.local');
  await page.goto(`${DEMO}/admin/contenido/redes`);
  await expect(page.getByText('aparecen en todas las sedes')).toBeVisible();

  await page.getByRole('button', { name: 'Añadir red' }).click();
  const dialog = page.getByRole('dialog', { name: 'Añadir red' });
  await dialog.getByLabel('Red').click();
  await page.getByRole('option', { name: 'WhatsApp' }).click();
  await dialog.getByLabel('Número o enlace').fill('300 123 4567');
  await expect(dialog.getByText('Se guardará como: https://wa.me/573001234567')).toBeVisible();
  await dialog.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('wa.me/573001234567', { exact: true })).toBeVisible();

  // Se borra al final de la prueba (repetible).
  const cleanup = async () => {
    await page.getByLabel('Mostrar').click();
    await page.getByRole('option', { name: 'Empresa (todas las sedes)' }).click();
    await page
      .getByRole('listitem')
      .filter({ hasText: 'wa.me/573001234567' })
      .getByRole('button', { name: 'Acciones de WhatsApp' })
      .click();
    await page.getByRole('menuitem', { name: 'Borrar' }).click();
    await page.getByRole('button', { name: 'Borrar', exact: true }).click();
    await expect(page.getByText('wa.me/573001234567', { exact: true })).toHaveCount(0);
  };

  // Sede Norte tiene redes propias (seed): reemplazan a las de la empresa.
  await page.getByLabel('Mostrar').click();
  await page.getByRole('option', { name: 'Sede: Sede Norte' }).click();
  await expect(page.getByText('Sede Norte tiene redes propias')).toBeVisible();
  await expect(page.getByText('wa.me/573001234567', { exact: true })).toHaveCount(0);
  await cleanup();

  // Patrocinador oculto en Centro.
  await page.goto(`${DEMO}/admin/contenido/patrocinadores`);
  const row = page.getByRole('switch', { name: / visible$/ }).first();
  await row.click();
  await expect(page.getByText('Oculto', { exact: true })).toBeVisible();
  await row.click();
  await expect(page.getByText('Oculto', { exact: true })).toHaveCount(0);
});

test('staff no ve los menús de contenido ni puede abrirlos', async ({ page }) => {
  await login(page, 'staff@demo.local');
  for (const name of ['Sedes', 'Acerca de', 'Patrocinadores', 'Redes sociales', 'Pie de página', 'Empresa']) {
    await expect(page.getByRole('link', { name, exact: true })).toHaveCount(0);
  }
  await page.goto(`${DEMO}/admin/sedes`);
  await expect(page).toHaveURL(`${DEMO}/admin`);
  await page.goto(`${DEMO}/admin/configuracion/empresa`);
  await expect(page).toHaveURL(`${DEMO}/admin`);
});
