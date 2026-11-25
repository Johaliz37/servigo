import { expect, test, type Page } from '@playwright/test';

// Criterios de aceptación de la fase 08 (disponibilidad y calendario). Requieren `pnpm db:start`
// (con seed) y `pnpm dev`. La prueba de UI usa la Sede Centro con horario propio vacío durante
// la prueba y al final borra lo que creó y la devuelve al horario general.
const DEMO = 'http://demo.localhost:5273';
const CENTRO = '20000000-0000-4000-a000-000000000001';
const CORTE = '30000000-0000-4000-a000-000000000001';
// Node no resuelve *.localhost: la API se llama en el host raíz con `?tenant=demo` (solo local).
const API = 'http://localhost:5273/api/public/slots?tenant=demo';

test.describe.configure({ mode: 'serial' });

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Lunes dentro de ~5 semanas (Bogotá): lejos de las reservas del seed y dentro de max_days_ahead (60). */
function futureMonday(): number {
  const today = Date.parse(`${iso(Date.now() - 5 * 3_600_000)}T00:00:00Z`);
  const dow = (new Date(today).getUTCDay() + 6) % 7;
  return today + (7 - dow) * DAY + 35 * DAY;
}

async function login(page: Page) {
  await page.goto(`${DEMO}/admin/login`);
  await page.getByLabel('Correo').fill('owner@demo.local');
  await page.getByLabel('Contraseña', { exact: true }).fill('Servigo123!');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(`${DEMO}/admin`);
}

const column = (page: Page, date: string) => page.locator(`.fc-timegrid-col[data-date="${date}"]`);
const allDayCell = (page: Page, date: string) => page.locator(`.fc-daygrid-day[data-date="${date}"]`);

async function openCalendar(page: Page, date: string) {
  await page.goto(`${DEMO}/admin/calendario?sede=${CENTRO}&fecha=${date}`);
  await expect(page.getByTestId('calendar-title')).not.toBeEmpty();
}

/** Crea un horario con el diálogo completo («+ Crear»). */
async function createEvent(
  page: Page,
  opts: {
    title: string;
    date: string;
    start?: string;
    end?: string;
    kind?: 'Atención' | 'No disponible';
    repeat?: string;
    allDay?: boolean;
  },
) {
  await page.getByRole('button', { name: 'Crear' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nuevo horario' });
  await dialog.getByLabel('Título').fill(opts.title);
  if (opts.kind) await dialog.getByRole('radio', { name: opts.kind }).click();
  if (opts.allDay) await dialog.getByRole('switch', { name: 'Todo el día' }).click();
  await dialog.getByLabel('Fecha de inicio').fill(opts.date);
  await dialog.getByLabel('Fecha de fin').fill(opts.date);
  if (!opts.allDay) {
    await dialog.getByLabel('Hora de inicio').fill(opts.start!);
    await dialog.getByLabel('Hora de fin').fill(opts.end!);
  }
  if (opts.repeat) {
    await dialog.getByRole('combobox', { name: 'Repetir' }).click();
    await page.getByRole('option', { name: opts.repeat }).click();
  }
  await dialog.getByRole('button', { name: 'Guardar' }).click();
  await expect(dialog).toBeHidden();
  // El velo del diálogo se desvanece después: hasta entonces se queda con los clics.
  await expect(page.locator('[data-slot="dialog-overlay"]')).toHaveCount(0);
}

/** Abre el detalle de un evento y responde al diálogo de alcance si aparece. */
async function deleteEvent(page: Page, event: ReturnType<Page['locator']>, scope = 'Todos los eventos') {
  await event.click();
  await page.getByRole('dialog', { name: 'Detalle' }).getByRole('button', { name: 'Eliminar' }).click();
  const ask = page.getByRole('alertdialog', { name: 'Eliminar evento recurrente' });
  if (await ask.isVisible().catch(() => false)) {
    await ask.getByRole('radio', { name: scope }).click();
    await ask.getByRole('button', { name: 'Eliminar' }).click();
  }
}

/** Deja la Sede Centro como al principio: sin eventos propios y con el horario general. */
async function resetCentro(page: Page, monday: string) {
  await openCalendar(page, monday);
  if (await page.getByText('Esta sede usa el horario general de la empresa').isVisible()) return;
  await page.getByRole('combobox', { name: 'Vista' }).click();
  await page.getByRole('option', { name: /Agenda/ }).click();
  for (let i = 0; i < 20; i++) {
    const events = page.locator('.fc-list-event.sv-ev:not(.sv-ev-booking)');
    if ((await events.count()) === 0) break;
    await deleteEvent(page, events.first());
    await expect(page.getByText('Evento eliminado').first()).toBeVisible();
    await page.waitForTimeout(300);
  }
  await page.getByRole('button', { name: 'Usar el horario general' }).click();
  await expect(page.getByText('Esta sede usa el horario general de la empresa')).toBeVisible();
}

test('L–V 8–17 + almuerzo + festivo: vista previa, «solo este», «este y los siguientes», arrastrar, estirar y deshacer', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const mondayMs = futureMonday();
  const day = (n: number) => iso(mondayMs + n * DAY);
  const [mon, tue, wed, thu, fri, sat] = [0, 1, 2, 3, 4, 5].map(day) as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];

  await login(page);
  await resetCentro(page, mon);
  await openCalendar(page, mon);

  // Horario propio vacío para la Sede Centro.
  await page.getByRole('button', { name: 'Activar horario propio' }).click();
  await page
    .getByRole('alertdialog', { name: 'Activar horario propio' })
    .getByRole('button', { name: 'Empezar vacío' })
    .click();
  await expect(page.getByText('Esta sede usa el horario general de la empresa')).toBeHidden();
  await expect(page.locator('.sv-ev')).toHaveCount(0);

  // L–V 8:00–17:00 cada semana + almuerzo (plantilla) + festivo el miércoles.
  await createEvent(page, {
    title: 'Oficina',
    date: mon,
    start: '08:00',
    end: '17:00',
    repeat: 'Todos los días laborables (lun–vie)',
  });
  await page.getByRole('button', { name: 'Almuerzo diario 12:00–13:00 (no disponible)' }).click();
  await createEvent(page, { title: 'Festivo prueba', date: wed, kind: 'No disponible', allDay: true });
  await expect(column(page, mon).locator('.sv-ev-open')).toContainText('8:00 - 17:00');
  await expect(allDayCell(page, wed)).toContainText('Festivo prueba');

  // Vista previa: «Corte + barba» (50 min + 10 de buffer) con paso de 30 → 8:00–11:00 y 13:00–16:00.
  await page.getByRole('combobox', { name: 'Filtrar por servicio' }).click();
  await page.getByRole('option', { name: 'Corte + barba' }).click();
  await page.getByRole('switch', { name: /Mostrar horarios reservables/ }).click();
  await expect(column(page, mon).locator('.fc-bg-event.sv-slot')).toHaveCount(14);
  await expect(column(page, tue).locator('.fc-bg-event.sv-slot')).toHaveCount(14);
  await expect(column(page, wed).locator('.fc-bg-event.sv-slot')).toHaveCount(0); // festivo
  await expect(column(page, sat).locator('.fc-bg-event.sv-slot')).toHaveCount(0);
  await page.getByRole('switch', { name: /Mostrar horarios reservables/ }).click();
  await page.getByRole('combobox', { name: 'Filtrar por servicio' }).click();
  await page.getByRole('option', { name: 'Todos los servicios' }).click();

  // «Solo este evento» el martes: los demás martes no cambian.
  await column(page, tue).locator('.sv-ev-open').click();
  await page.getByRole('dialog', { name: 'Detalle' }).getByRole('button', { name: 'Editar' }).click();
  const edit = page.getByRole('dialog', { name: 'Editar horario' });
  await edit.getByLabel('Hora de inicio').fill('10:00');
  await edit.getByRole('button', { name: 'Guardar' }).click();
  const askEdit = page.getByRole('alertdialog', { name: 'Editar evento recurrente' });
  await askEdit.getByRole('radio', { name: 'Este evento' }).click();
  await askEdit.getByRole('button', { name: 'Aceptar' }).click();
  await expect(column(page, tue).locator('.sv-ev-open')).toContainText('10:00 - 17:00');
  await expect(column(page, mon).locator('.sv-ev-open')).toContainText('8:00 - 17:00');
  await page.getByRole('button', { name: 'Siguiente (j)' }).click();
  await expect(column(page, iso(mondayMs + 8 * DAY)).locator('.sv-ev-open')).toContainText('8:00 - 17:00');
  await page.getByRole('button', { name: 'Anterior (k)' }).click();

  // «Este y los siguientes» desde el jueves: la serie se corta.
  await column(page, thu).locator('.sv-ev-open').click();
  await page.getByRole('dialog', { name: 'Detalle' }).getByRole('button', { name: 'Editar' }).click();
  await edit.getByLabel('Título').fill('Oficina tarde');
  await edit.getByLabel('Hora de inicio').fill('13:00');
  await edit.getByRole('button', { name: 'Guardar' }).click();
  await askEdit.getByRole('radio', { name: 'Este y los siguientes' }).click();
  await askEdit.getByRole('button', { name: 'Aceptar' }).click();
  await expect(column(page, wed).locator('.sv-ev-open')).toContainText('Oficina');
  await expect(column(page, wed).locator('.sv-ev-open')).not.toContainText('tarde');
  await expect(column(page, thu).locator('.sv-ev-open')).toContainText('Oficina tarde');
  await expect(column(page, fri).locator('.sv-ev-open')).toContainText('13:00 - 17:00');
  await page.getByRole('button', { name: 'Siguiente (j)' }).click();
  await expect(column(page, iso(mondayMs + 7 * DAY)).locator('.sv-ev-open')).toContainText('Oficina tarde');
  await page.getByRole('button', { name: 'Anterior (k)' }).click();

  // Arrastrar y estirar un evento suelto; persiste tras recargar. (A la izquierda: los avisos
  // aparecen abajo a la derecha y taparían el evento.)
  await createEvent(page, { title: 'Reunión', date: tue, start: '18:00', end: '19:00', kind: 'No disponible' });
  const meeting = page.locator('.sv-ev-closed', { hasText: 'Reunión' });
  // Tras guardar, la caché se recarga y FullCalendar vuelve a pintar: arrastrar después.
  await page.waitForLoadState('networkidle');
  await meeting.scrollIntoViewIfNeeded();
  const from = (await meeting.boundingBox())!;
  const target = (await column(page, wed).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + 8);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 - 20, from.y + 8, { steps: 5 });
  await page.mouse.move(target.x + target.width / 2, from.y + 8, { steps: 10 });
  await page.mouse.up();
  await expect(column(page, wed).locator('.sv-ev-closed', { hasText: 'Reunión' })).toBeVisible();

  const moved = column(page, wed).locator('.sv-ev-closed:not(.fc-event-mirror)', { hasText: 'Reunión' });
  await page.waitForLoadState('networkidle');
  await moved.hover();
  const handle = moved.locator('.fc-event-resizer-end');
  const box = (await handle.boundingBox())!;
  const slot = (await page.locator('.fc-timegrid-slot').first().boundingBox())!.height; // 30 min
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + slot, { steps: 4 });
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + slot * 2, { steps: 4 });
  await page.mouse.up();
  await expect(moved).toContainText('18:00 - 20:00');
  await page.reload();
  await expect(column(page, wed).locator('.sv-ev-closed', { hasText: 'Reunión' })).toContainText('18:00 - 20:00');
  await expect(column(page, tue).locator('.sv-ev-closed', { hasText: 'Reunión' })).toHaveCount(0);

  // Eliminar con «Deshacer».
  await deleteEvent(page, column(page, wed).locator('.sv-ev-closed', { hasText: 'Reunión' }));
  await expect(column(page, wed).locator('.sv-ev-closed', { hasText: 'Reunión' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Deshacer' }).click();
  await expect(column(page, wed).locator('.sv-ev-closed', { hasText: 'Reunión' })).toBeVisible();

  // Limpieza: borra todo lo creado y vuelve al horario general.
  await resetCentro(page, mon);
});

// Después de la prueba de UI, que deja la Sede Centro con el horario general.
test('una sede sin horario propio usa los eventos de la empresa en /api/public/slots', async ({ request }) => {
  const monday = iso(futureMonday());
  const res = await request.get(
    `${API}&branch=${CENTRO}&service=${CORTE}&from=${monday}&to=${iso(futureMonday() + 6 * DAY)}`,
  );
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { timezone: string; days: { date: string; slots: { start: string }[] }[] };
  expect(body.timezone).toBe('America/Bogota');
  const hours = (date: string) =>
    body.days
      .find((d) => d.date === date)
      ?.slots.map((s) => new Date(Date.parse(s.start) - 5 * 3_600_000).toISOString().slice(11, 16)) ?? [];
  // Horario general: L–S 9:00–19:00 con almuerzo L–V 13:00–14:00; Corte de 30 min, paso de 30.
  const mon = hours(monday);
  expect(mon[0]).toBe('09:00');
  expect(mon.at(-1)).toBe('18:30');
  expect(mon).not.toContain('13:00');
  expect(mon).not.toContain('13:30');
  expect(hours(iso(futureMonday() + 5 * DAY))).toContain('13:00'); // el sábado no hay almuerzo
  expect(body.days.map((d) => d.date)).not.toContain(iso(futureMonday() + 6 * DAY)); // domingo cerrado

  expect((await request.get(`${API}&branch=${CENTRO}&service=x&from=${monday}&to=${monday}`)).status()).toBe(400);
});
