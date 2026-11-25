import { expect, test, type Locator, type Page } from '@playwright/test';

// Criterios de aceptación de la fase 06 (catálogo). Requieren `pnpm db:start` (con seed) y
// `pnpm dev`. Cada prueba deja los datos como estaban, para poder repetirse.
const PASSWORD = 'Servigo123!';
const DEMO = 'http://demo.localhost:5273';
const TZ = 'America/Bogota';

test.describe.configure({ mode: 'serial' });

async function login(page: Page) {
  await page.goto(`${DEMO}/admin/login`);
  await page.getByLabel('Correo').fill('owner@demo.local');
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(`${DEMO}/admin`);
}

async function makePng(page: Page, seed: number): Promise<Buffer> {
  const dataUrl = await page.evaluate((s) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1600;
    canvas.height = 1200;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = `hsl(${s * 67} 60% 50%)`;
    ctx.fillRect(0, 0, 1600, 1200);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 300px sans-serif';
    ctx.fillText(String(s), 600, 750);
    return canvas.toDataURL('image/png');
  }, seed);
  return Buffer.from(dataUrl.split(',')[1]!, 'base64');
}

async function uploadPhoto(page: Page, seed: number) {
  await page.locator('input[type=file][aria-label="Foto"]').setInputFiles({
    name: `e2e-${seed}.png`,
    mimeType: 'image/png',
    buffer: await makePng(page, seed),
  });
  const dialog = page.getByRole('dialog', { name: /Recortar foto/i });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Usar imagen', exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
}

async function setSwitch(control: Locator, on: boolean) {
  if ((await control.getAttribute('aria-checked')) !== String(on)) await control.click();
  await expect(control).toHaveAttribute('aria-checked', String(on));
}

/** 'yyyy-mm-dd' y 'dd/MM' de mañana en la zona de la empresa demo. */
function tomorrow() {
  const d = new Date(Date.now() + 86_400_000);
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
  const [y, m, dd] = day.split('-');
  return { input: `${y}-${m}-${dd}`, badge: `${dd}/${m}` };
}

test('servicio con 3 detalles, 4 fotos y -15 % hasta mañana: el listado muestra el precio rebajado y el badge', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const name = `E2E Servicio ${Date.now()}`;
  await login(page);
  await page.getByRole('link', { name: 'Servicios' }).click();
  await page.getByRole('link', { name: 'Nuevo servicio' }).first().click();
  await expect(page.getByRole('heading', { name: 'Nuevo servicio' })).toBeVisible();

  // General
  await page.getByLabel('Nombre', { exact: true }).fill(name);
  await page.getByLabel('Precio (COP)').fill('40000');
  await page.getByLabel('Duración').fill('45');

  // Detalles
  await page.getByRole('tab', { name: 'Detalles' }).click();
  for (const [i, [label, value]] of [
    ['Incluye', 'Toalla caliente'],
    ['Duración', '45 minutos'],
    ['Producto', 'Cera mate'],
  ].entries()) {
    await page.getByRole('button', { name: 'Añadir detalle' }).click();
    await page.getByLabel(`Detalle ${i + 1}`, { exact: true }).fill(label!);
    await page.getByTestId('detail-row').nth(i).getByLabel('Valor (opcional)').fill(value!);
  }

  // Fotos: el texto alternativo es obligatorio.
  await page.getByRole('tab', { name: 'Fotos' }).click();
  for (const seed of [1, 2, 3, 4]) await uploadPhoto(page, seed);
  await expect(page.getByTestId('photo-row')).toHaveCount(4);
  await page.getByRole('button', { name: 'Crear servicio' }).click();
  await expect(page.getByText('Revisa los campos marcados.')).toBeVisible();
  await expect(page.getByText('Describe la foto').first()).toBeVisible();
  const alts = page.getByLabel('Texto alternativo');
  for (let i = 0; i < 4; i++) await alts.nth(i).fill(`Foto ${i + 1} del servicio`);
  await page.getByTestId('photo-row').nth(1).getByRole('button', { name: 'Usar de portada' }).click();

  // Descuento del 15 % hasta mañana.
  const until = tomorrow();
  await page.getByRole('tab', { name: 'Descuentos' }).click();
  await page.getByRole('button', { name: 'Añadir descuento' }).click();
  const discount = page.getByTestId('discount-row');
  await discount.getByLabel('Valor', { exact: true }).fill('15');
  await discount.getByLabel('Fecha límite').fill(until.input);
  await expect(discount.getByText('Vigente')).toBeVisible();
  await expect(discount.getByTestId('discount-preview')).toContainText('34.000');

  await page.getByRole('button', { name: 'Crear servicio' }).click();
  await expect(page.getByText('Servicio creado')).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/catalogo\/servicios\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();

  // Al recargar la ficha, todo quedó guardado.
  await page.reload();
  await page.getByRole('tab', { name: 'Detalles' }).click();
  await expect(page.getByTestId('detail-row')).toHaveCount(3);
  await page.getByRole('tab', { name: 'Fotos' }).click();
  await expect(page.getByTestId('photo-row')).toHaveCount(4);
  await expect(page.getByTestId('photo-row').nth(1).getByRole('button', { name: 'Portada' })).toBeVisible();

  // Listado: precio rebajado y badge.
  await page.getByRole('link', { name: 'Servicios' }).first().click();
  await page.getByLabel('Buscar por nombre o referencia').fill(name);
  const row = page.getByTestId('catalog-row').filter({ hasText: name });
  await expect(row).toHaveCount(1);
  const price = row.getByTestId('catalog-item-price');
  await expect(price).toContainText('34.000');
  await expect(price).toContainText('40.000');
  await expect(price).toContainText(`−15 % hasta ${until.badge}`);
  const thumb = (await row.locator('img').getAttribute('src'))!;
  expect((await request.get(thumb)).ok()).toBe(true);

  // Limpieza: sin reservas se puede eliminar, y sus fotos se borran del Storage.
  await row.getByRole('button', { name: `Acciones de ${name}` }).click();
  await page.getByRole('menuitem', { name: 'Eliminar' }).click();
  const dialog = page.getByRole('alertdialog', { name: `¿Eliminar «${name}»?` });
  await expect(dialog.getByText('No se puede deshacer')).toBeVisible();
  await dialog.getByRole('button', { name: 'Eliminar' }).click();
  await expect(page.getByText('Eliminado', { exact: true })).toBeVisible();
  await expect(row).toHaveCount(0);
  await expect.poll(async () => (await request.get(thumb)).ok()).toBe(false);
});

test('producto sin "añadir a la reserva": aviso en el servicio; duplicar, salir sin guardar y no borrar con reservas', async ({
  page,
}) => {
  const name = `E2E Producto ${Date.now()}`;
  await login(page);
  await page.getByRole('link', { name: 'Productos' }).click();
  await page.getByRole('link', { name: 'Nuevo producto' }).first().click();
  await page.getByLabel('Nombre', { exact: true }).fill(name);
  await page.getByLabel('Precio (COP)').fill('1000');
  await setSwitch(page.getByRole('switch', { name: 'Se puede añadir dentro de una reserva' }), false);
  await page.getByRole('button', { name: 'Crear producto' }).click();
  await expect(page.getByText('Producto creado')).toBeVisible();

  // En un servicio, el producto asociado avisa que no se mostrará al reservar.
  await page.getByRole('link', { name: 'Servicios' }).first().click();
  await page.getByRole('link', { name: 'Corte de cabello', exact: true }).click();
  await page.getByRole('tab', { name: 'Productos' }).click();
  await page.getByRole('button', { name: 'Añadir producto' }).click();
  await page.getByRole('option', { name: new RegExp(name) }).click();
  await expect(
    page
      .getByTestId('product-row')
      .filter({ hasText: name })
      .getByText(/no se mostrará al reservar/),
  ).toBeVisible();

  // Salir sin guardar pide confirmación; nada cambia.
  await page.getByRole('link', { name: 'Cancelar' }).click();
  const leave = page.getByRole('alertdialog', { name: '¿Salir sin guardar?' });
  await expect(leave).toBeVisible();
  await leave.getByRole('button', { name: 'Salir sin guardar' }).click();
  await expect(page).toHaveURL(`${DEMO}/admin/catalogo/servicios`);

  // Un servicio con reservas no se elimina: se ofrece inactivarlo.
  await page.getByRole('button', { name: 'Acciones de Corte de cabello' }).click();
  await page.getByRole('menuitem', { name: 'Eliminar' }).click();
  const blocked = page.getByRole('alertdialog', { name: '¿Eliminar «Corte de cabello»?' });
  await expect(blocked.getByText(/tiene reservas/)).toBeVisible();
  await expect(blocked.getByRole('button', { name: 'Inactivar' })).toBeVisible();
  await blocked.getByRole('button', { name: 'Cancelar' }).click();

  // Duplicar crea una copia inactiva; se elimina desde su ficha.
  await page.getByRole('link', { name: 'Productos' }).first().click();
  await page.getByRole('button', { name: `Acciones de ${name}`, exact: true }).click();
  await page.getByRole('menuitem', { name: 'Duplicar' }).click();
  await expect(page.getByRole('heading', { name: `${name} (copia)`, level: 1 })).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Activo' })).toHaveAttribute('aria-checked', 'false');
  await page.getByRole('button', { name: 'Eliminar' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Eliminar' }).click();
  await expect(page).toHaveURL(`${DEMO}/admin/catalogo/productos`);

  // Limpieza del original.
  await page.getByRole('button', { name: `Acciones de ${name}`, exact: true }).click();
  await page.getByRole('menuitem', { name: 'Eliminar' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Eliminar' }).click();
  await expect(page.getByTestId('catalog-row').filter({ hasText: name })).toHaveCount(0);
});

test('sede con catálogo propio: disponibilidad y precio por sede se reflejan en el listado filtrado', async ({
  page,
}) => {
  await login(page);
  const openBranchMenu = async () => {
    await page.goto(`${DEMO}/admin/sedes`);
    await page.getByRole('button', { name: 'Acciones de Sede Norte' }).click();
  };
  const setOwnCatalog = async (on: boolean) => {
    await openBranchMenu();
    await page.getByRole('menuitem', { name: 'Editar' }).click();
    await setSwitch(page.getByRole('switch', { name: 'Catálogo propio' }), on);
    await page.getByRole('button', { name: 'Guardar sede' }).click();
    await expect(page.getByText(/Sede Norte guardada/)).toBeVisible();
  };

  await setOwnCatalog(true);
  await openBranchMenu();
  await page.getByRole('menuitem', { name: 'Catálogo de la sede' }).click();
  await expect(page.getByRole('heading', { name: 'Catálogo de Sede Norte' })).toBeVisible();

  const corte = page.getByLabel('Precio de Corte de cabello en la sede');
  // Siempre un valor distinto del guardado (si una corrida anterior quedó a medias).
  const target = (await corte.inputValue()) === '30000' ? '31000' : '30000';
  await corte.fill(target);
  await corte.press('Enter');
  await expect(page.getByText('Precio de la sede guardado')).toBeVisible();
  await setSwitch(page.getByRole('switch', { name: 'Arreglo de barba disponible en la sede' }), false);

  // Listado filtrado por la sede: precio propio y sin el servicio no disponible.
  await page.getByRole('link', { name: 'Servicios' }).first().click();
  await page.getByRole('combobox', { name: 'Filtrar por sede' }).click();
  await page.getByRole('option', { name: 'Sede Norte' }).click();
  await expect(
    page.getByTestId('catalog-row').filter({ hasText: 'Corte de cabello' }).getByTestId('catalog-item-price'),
  ).toContainText(`${target.slice(0, 2)}.000`);
  await expect(page.getByTestId('catalog-row').filter({ hasText: 'Arreglo de barba' })).toHaveCount(0);

  // La ficha muestra la pestaña Sedes con la disponibilidad.
  await page.getByRole('link', { name: 'Corte de cabello', exact: true }).click();
  await page.getByRole('tab', { name: 'Sedes' }).click();
  await expect(page.getByTestId('branch-row').filter({ hasText: 'Sede Centro' })).toContainText(
    'Incluido automáticamente',
  );
  await expect(page.getByLabel('Precio en la sede (COP)')).toHaveValue(target);

  // Restaurar.
  await page.goto(`${DEMO}/admin/sedes`);
  await page.getByRole('button', { name: 'Acciones de Sede Norte' }).click();
  await page.getByRole('menuitem', { name: 'Catálogo de la sede' }).click();
  await page.getByLabel('Precio de Corte de cabello en la sede').fill('');
  await page.getByLabel('Precio de Corte de cabello en la sede').press('Enter');
  await expect(page.getByText('Precio de la sede guardado')).toBeVisible();
  await page.getByRole('button', { name: 'Activar todos' }).first().click();
  await expect(page.getByText('Servicios: todos disponibles')).toBeVisible();
  await setOwnCatalog(false);
});
