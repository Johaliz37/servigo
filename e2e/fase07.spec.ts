import { expect, test, type Page } from '@playwright/test';

// Criterios de aceptación de la fase 07 (información adicional). Requieren `pnpm db:start`
// (con seed) y `pnpm dev`. Cada prueba deja los datos como estaban.
const DEMO = 'http://demo.localhost:5273';

test.describe.configure({ mode: 'serial' });

async function login(page: Page) {
  await page.goto(`${DEMO}/admin/login`);
  await page.getByLabel('Correo').fill('owner@demo.local');
  await page.getByLabel('Contraseña', { exact: true }).fill('Servigo123!');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(`${DEMO}/admin`);
}

/** Crea un campo con el selector de tipo y el panel lateral. */
async function addField(
  page: Page,
  type: RegExp,
  label: string,
  opts: { required?: boolean; options?: string[] } = {},
) {
  await page.getByRole('button', { name: 'Añadir campo' }).click();
  await page.getByRole('dialog', { name: '¿Qué tipo de campo?' }).getByRole('button', { name: type }).click();
  const sheet = page.getByRole('dialog', { name: 'Nuevo campo' });
  await sheet.getByLabel('Pregunta o etiqueta').fill(label);
  for (const [i, option] of (opts.options ?? []).entries()) {
    await sheet.getByRole('button', { name: 'Añadir opción' }).click();
    await sheet.getByLabel(`Opción ${i + 1}`, { exact: true }).fill(option);
  }
  const required = sheet.getByRole('switch', { name: 'Obligatorio' });
  if ((await required.getAttribute('aria-checked')) !== String(!!opts.required)) await required.click();
  await sheet.getByRole('button', { name: 'Añadir campo' }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByTestId('field-card').filter({ hasText: label })).toBeVisible();
}

async function deleteField(page: Page, label: string) {
  await page.getByRole('button', { name: `Acciones de ${label}`, exact: true }).click();
  await page.getByRole('menuitem', { name: 'Eliminar' }).click();
  const dialog = page.getByRole('alertdialog', { name: `¿Eliminar «${label}»?` });
  await dialog.getByRole('button', { name: 'Eliminar' }).click();
  await expect(page.getByTestId('field-card').filter({ hasText: label })).toHaveCount(0);
}

/** Etiquetas de la vista previa, en orden (sin el asterisco de obligatorio). */
async function previewLabels(page: Page): Promise<string[]> {
  const labels = await page.getByTestId('fields-preview').locator('[data-slot="form-label"]').allInnerTexts();
  return labels.map((l) => l.replace(/\s*\*.*$/s, '').trim());
}

test('2 campos generales y 2 del servicio: la vista previa los muestra en orden y valida obligatorios', async ({
  page,
}) => {
  const tag = Date.now().toString().slice(-5);
  const general = [`Nombre del acompañante ${tag}`, `Acepto políticas ${tag}`];
  const own = [`Presión ${tag}`, `Zonas ${tag}`];

  await login(page);
  await page.getByRole('link', { name: 'Información adicional' }).click();
  await expect(page.getByRole('heading', { name: 'Información adicional', level: 1 })).toBeVisible();

  await addField(page, /Texto corto/, general[0]!);
  await addField(page, /^Check/, general[1]!, { required: true });

  await page
    .getByRole('navigation', { name: 'Grupos de campos' })
    .getByRole('button', { name: /Corte de cabello/ })
    .click();
  await expect(page).toHaveURL(/servicio=/);
  await addField(page, /Lista de opciones/, own[0]!, { required: true, options: ['Suave', 'Media', 'Fuerte'] });
  await addField(page, /Lista de ítems \(varias\)/, own[1]!, { options: ['Espalda', 'Cuello', 'Piernas'] });

  // Vista previa: generales (incluido el del seed) y luego los del servicio.
  await expect.poll(() => previewLabels(page)).toEqual(['¿Cómo nos conociste?', ...general, ...own]);
  const preview = page.getByTestId('fields-preview');
  await expect(preview.getByRole('radio', { name: 'Media' })).toBeVisible();
  await expect(preview.getByRole('checkbox', { name: 'Cuello' })).toBeVisible();

  // Validación: el check obligatorio sin marcar y la presión sin elegir fallan.
  await preview.getByRole('button', { name: 'Probar validación' }).click();
  await expect(preview.getByText('Debes marcar esta casilla')).toBeVisible();
  await expect(preview.getByText('Este dato es obligatorio')).toBeVisible();
  await preview.getByRole('checkbox', { name: new RegExp(general[1]!) }).click();
  await preview.getByRole('radio', { name: 'Fuerte' }).click();
  await preview.getByRole('button', { name: 'Probar validación' }).click();
  await expect(page.getByText('Todo correcto')).toBeVisible();

  // Un servicio sin campos propios muestra solo los generales.
  await page
    .getByRole('navigation', { name: 'Grupos de campos' })
    .getByRole('button', { name: /Arreglo de barba/ })
    .click();
  await expect.poll(() => previewLabels(page)).toEqual(['¿Cómo nos conociste?', ...general]);

  // Limpieza.
  await page
    .getByRole('navigation', { name: 'Grupos de campos' })
    .getByRole('button', { name: /Corte de cabello/ })
    .click();
  for (const label of own) await deleteField(page, label);
  await page
    .getByRole('navigation', { name: 'Grupos de campos' })
    .getByRole('button', { name: /Campos generales/ })
    .click();
  for (const label of general) await deleteField(page, label);
});

test('renombrar una opción conserva su valor; un campo con respuestas solo se inactiva; atajo desde el servicio', async ({
  page,
}) => {
  await login(page);
  await page.goto(`${DEMO}/admin/formularios`);
  const label = '¿Cómo nos conociste?';

  const rename = async (from: string, to: string) => {
    await page.getByRole('button', { name: label, exact: true }).click();
    const sheet = page.getByRole('dialog', { name: 'Editar campo' });
    const option = sheet.getByTestId('option-row').filter({ has: page.locator(`input[value="${from}"]`) });
    await expect(option.getByText('Valor guardado: instagram')).toBeVisible();
    await option.getByRole('textbox').fill(to);
    await sheet.getByRole('button', { name: 'Guardar campo' }).click();
    await expect(sheet).toBeHidden();
  };

  await rename('Instagram', 'Instagram o TikTok');
  await expect(page.getByTestId('fields-preview').getByText(label)).toBeVisible();
  // Al reabrir, el valor guardado sigue siendo el mismo (las respuestas no se rompen).
  await rename('Instagram o TikTok', 'Instagram');

  // Tiene respuestas en el seed: no se elimina, se ofrece inactivar.
  await page.getByRole('button', { name: `Acciones de ${label}` }).click();
  await page.getByRole('menuitem', { name: 'Eliminar' }).click();
  const dialog = page.getByRole('alertdialog', { name: `¿Eliminar «${label}»?` });
  await expect(dialog.getByText(/ya tiene respuestas/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Inactivar' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancelar' }).click();

  // Atajo desde la ficha del servicio.
  await page.goto(`${DEMO}/admin/catalogo/servicios`);
  await page.getByRole('link', { name: 'Corte de cabello', exact: true }).click();
  await page.getByRole('tab', { name: 'Información adicional' }).click();
  await expect(page.getByText(label)).toBeVisible();
  await page.getByRole('link', { name: 'Editar campos de este servicio' }).click();
  await expect(page).toHaveURL(/\/admin\/formularios\?servicio=30000000-0000-4000-a000-000000000001$/);
  await expect(page.getByRole('heading', { name: 'Corte de cabello', level: 2 })).toBeVisible();
});
