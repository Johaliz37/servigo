import { describe, expect, it } from 'vitest';
import { expandEvents, localDate, toAvailabilityEvent, wallToInstant } from './availability';
import {
  applyPlan,
  invertPlan,
  planChange,
  planCopyTo,
  planDelete,
  planDuplicate,
  type EventRow,
  type OccurrenceRef,
  type Plan,
} from './calendar';

const BOG = 'America/Bogota';
const at = (local: string) => wallToInstant(Date.parse(`${local}:00Z`), BOG);
const iso = (local: string) => new Date(at(local)).toISOString();

function row(partial: Partial<EventRow> & { id: string }): EventRow {
  return {
    company_id: 'c',
    branch_id: null,
    kind: 'open',
    title: '',
    notes: null,
    color: null,
    starts_at: iso('2026-11-03T09:00'),
    ends_at: iso('2026-11-03T10:00'),
    all_day: false,
    timezone: BOG,
    rrule: null,
    exdates: [],
    recurrence_parent_id: null,
    recurrence_original_start: null,
    service_ids: null,
    capacity_override: null,
    created_at: '',
    updated_at: '',
    ...partial,
  };
}

let n = 0;
const makeId = () => `new${++n}`;

/** Ocurrencias visibles en noviembre: «YYYY-MM-DD HH:MM título». */
function visible(rows: EventRow[]): string[] {
  return expandEvents(rows.map(toAvailabilityEvent), at('2026-11-01T00:00'), at('2026-12-31T00:00')).map((o) => {
    const wall = new Date(o.start - 5 * 3_600_000).toISOString();
    return `${wall.slice(0, 10)} ${wall.slice(11, 16)} ${o.event.title}`;
  });
}

function occ(rows: EventRow[], id: string, date: string): OccurrenceRef {
  const o = expandEvents(rows.map(toAvailabilityEvent), at('2026-11-01T00:00'), at('2026-12-31T00:00')).find(
    (x) => x.event.id === id && localDate(x.start, BOG) === date,
  );
  if (!o) throw new Error(`sin ocurrencia ${id} ${date}`);
  return { eventId: id, start: o.start, end: o.end, originalStart: o.originalStart };
}

/** Aplica y comprueba que el inverso deja todo como estaba. */
function roundTrip(rows: EventRow[], plan: Plan): EventRow[] {
  const after = applyPlan(rows, plan);
  const undone = applyPlan(after, invertPlan(plan, rows));
  const sort = (list: EventRow[]) => [...list].sort((a, b) => a.id.localeCompare(b.id));
  expect(sort(undone)).toEqual(sort(rows));
  return after;
}

// Martes 9:00–10:00, 5 semanas: 3, 10, 17, 24 nov y 1 dic.
const tuesdays = () => [row({ id: 's', title: 'Mañana', rrule: 'FREQ=WEEKLY;BYDAY=TU;COUNT=5' })];

describe('planes del calendario', () => {
  it('«Este evento»: excepción + exdate; los demás martes no cambian', () => {
    const rows = tuesdays();
    const o = occ(rows, 's', '2026-11-10');
    const plan = planChange(
      rows,
      o,
      'this',
      { starts_at: iso('2026-11-10T15:00'), ends_at: iso('2026-11-10T16:00') },
      makeId,
    );
    const after = roundTrip(rows, plan);
    expect(visible(after)).toEqual([
      '2026-11-03 09:00 Mañana',
      '2026-11-10 15:00 Mañana',
      '2026-11-17 09:00 Mañana',
      '2026-11-24 09:00 Mañana',
      '2026-12-01 09:00 Mañana',
    ]);
    const child = after.find((r) => r.recurrence_parent_id === 's')!;
    expect(child).toMatchObject({ rrule: null, recurrence_original_start: iso('2026-11-10T09:00') });

    // Cambiar el tipo de una sola ocurrencia la deja suelta (la BD exige el mismo tipo).
    const kind = planChange(rows, o, 'this', { kind: 'closed' }, makeId);
    expect(kind.inserts[0]).toMatchObject({ kind: 'closed', recurrence_parent_id: null, rrule: null });
  });

  it('«Este y los siguientes»: corta la serie y sigue otra con el COUNT restante', () => {
    const rows = tuesdays();
    const plan = planChange(
      rows,
      occ(rows, 's', '2026-11-17'),
      'following',
      { title: 'Tarde', starts_at: iso('2026-11-17T14:00'), ends_at: iso('2026-11-17T15:30') },
      makeId,
    );
    const after = roundTrip(rows, plan);
    expect(visible(after)).toEqual([
      '2026-11-03 09:00 Mañana',
      '2026-11-10 09:00 Mañana',
      '2026-11-17 14:00 Tarde',
      '2026-11-24 14:00 Tarde',
      '2026-12-01 14:00 Tarde',
    ]);
    expect(plan.inserts[0]!.rrule).toBe('FREQ=WEEKLY;BYDAY=TU;COUNT=3');
    expect(plan.updates[0]!.patch.rrule).toBe('FREQ=WEEKLY;BYDAY=TU;UNTIL=20261117T135959Z');
  });

  it('«Este y los siguientes» desde la primera = «Todos»', () => {
    const rows = tuesdays();
    const plan = planChange(rows, occ(rows, 's', '2026-11-03'), 'following', { title: 'Otro' }, makeId);
    expect(plan).toEqual({ inserts: [], updates: [{ id: 's', patch: { title: 'Otro' } }], deletes: [] });
  });

  it('las excepciones posteriores pasan a la serie nueva si no se movió; si se movió, se borran', () => {
    const base = tuesdays();
    const withChild = applyPlan(
      base,
      planChange(base, occ(base, 's', '2026-11-24'), 'this', { title: 'Especial' }, makeId),
    );
    const o = occ(withChild, 's', '2026-11-17');
    const rename = planChange(withChild, o, 'following', { title: 'Nuevo' }, makeId);
    const renamed = roundTrip(withChild, rename);
    expect(visible(renamed)).toEqual([
      '2026-11-03 09:00 Mañana',
      '2026-11-10 09:00 Mañana',
      '2026-11-17 09:00 Nuevo',
      '2026-11-24 09:00 Especial',
      '2026-12-01 09:00 Nuevo',
    ]);
    const move = planChange(
      withChild,
      o,
      'following',
      { starts_at: iso('2026-11-17T11:00'), ends_at: iso('2026-11-17T12:00') },
      makeId,
    );
    expect(move.deletes).toHaveLength(1);
    expect(visible(roundTrip(withChild, move)).slice(2)).toEqual([
      '2026-11-17 11:00 Mañana',
      '2026-11-24 11:00 Mañana',
      '2026-12-01 11:00 Mañana',
    ]);
  });

  it('«Todos»: mover la serie un día gira BYDAY y desplaza exdates y excepciones', () => {
    const base = tuesdays();
    const withEx = applyPlan(base, planDelete(base, occ(base, 's', '2026-11-10'), 'this'));
    const withChild = applyPlan(
      withEx,
      planChange(withEx, occ(withEx, 's', '2026-11-24'), 'this', { title: 'Especial' }, makeId),
    );
    const plan = planChange(
      withChild,
      occ(withChild, 's', '2026-11-17'),
      'all',
      { starts_at: iso('2026-11-18T10:00'), ends_at: iso('2026-11-18T11:00') },
      makeId,
    );
    expect(plan.updates[0]!.patch.rrule).toBe('FREQ=WEEKLY;BYDAY=WE;COUNT=5');
    const after = roundTrip(withChild, plan);
    // La excepción conserva su propio horario (9:00 del 24) pero ahora reemplaza al miércoles 25.
    expect(visible(after)).toEqual([
      '2026-11-04 10:00 Mañana',
      '2026-11-18 10:00 Mañana',
      '2026-11-24 09:00 Especial',
      '2026-12-02 10:00 Mañana',
    ]);
  });

  it('un evento suelto se actualiza sin importar el alcance', () => {
    const rows = [row({ id: 'x' })];
    const plan = planChange(rows, occ(rows, 'x', '2026-11-03'), 'this', { title: 'Y' }, makeId);
    expect(plan).toEqual({ inserts: [], updates: [{ id: 'x', patch: { title: 'Y' } }], deletes: [] });
  });

  it('borrar: este, este y los siguientes, todos (con deshacer)', () => {
    const base = tuesdays();
    const withChild = applyPlan(
      base,
      planChange(base, occ(base, 's', '2026-11-24'), 'this', { title: 'Especial' }, makeId),
    );
    const one = planDelete(withChild, occ(withChild, 's', '2026-11-10'), 'this');
    expect(visible(roundTrip(withChild, one))).toHaveLength(4);

    const following = planDelete(withChild, occ(withChild, 's', '2026-11-17'), 'following');
    expect(visible(roundTrip(withChild, following))).toEqual(['2026-11-03 09:00 Mañana', '2026-11-10 09:00 Mañana']);

    const all = planDelete(withChild, occ(withChild, 's', '2026-11-17'), 'all');
    expect(all.deletes.at(-1)).toBe('s');
    expect(roundTrip(withChild, all)).toEqual([]);
    // Desde la primera, «este y los siguientes» borra la serie.
    expect(planDelete(withChild, occ(withChild, 's', '2026-11-03'), 'following')).toEqual(all);

    // Una excepción se borra sola; su ocurrencia original sigue excluida.
    const childId = withChild.find((r) => r.recurrence_parent_id)!.id;
    const ex = planDelete(withChild, occ(withChild, childId, '2026-11-24'), 'this');
    expect(ex.deletes).toEqual([childId]);
    expect(visible(roundTrip(withChild, ex))).toHaveLength(4);
  });

  it('duplicar y copiar a otra sede', () => {
    const base = tuesdays();
    const single = [row({ id: 'x', title: 'Único' })];
    expect(planDuplicate(single, occ(single, 'x', '2026-11-03'), makeId).inserts[0]).toMatchObject({
      title: 'Único (copia)',
      starts_at: single[0]!.starts_at,
    });
    const series = planDuplicate(base, occ(base, 's', '2026-11-17'), makeId).inserts[0]!;
    expect(series).toMatchObject({ rrule: base[0]!.rrule, starts_at: base[0]!.starts_at, title: 'Mañana (copia)' });

    const withChild = applyPlan(
      base,
      planChange(base, occ(base, 's', '2026-11-24'), 'this', { title: 'Especial' }, makeId),
    );
    const copy = planCopyTo(withChild, 'b2', makeId);
    expect(copy.inserts.map((r) => r.branch_id)).toEqual(['b2', 'b2']);
    const [parent, child] = copy.inserts;
    expect(child!.recurrence_parent_id).toBe(parent!.id);
    expect(parent!.id).not.toBe('s');
    // Una excepción cuya serie no viene en la copia queda suelta.
    const orphan = planCopyTo([withChild[1]!], 'b2', makeId).inserts[0]!;
    expect(orphan).toMatchObject({ recurrence_parent_id: null, recurrence_original_start: null });
  });
});
