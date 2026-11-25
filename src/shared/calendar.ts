/**
 * Cambios del calendario de disponibilidad (fase 08 parte A) como *planes* que la RPC
 * `apply_availability_plan` aplica en una transacción: {inserts, updates, deletes}. Editar o
 * borrar una ocurrencia de una serie sigue a Google Calendar («Este evento», «Este y los
 * siguientes», «Todos los eventos»), y cada plan tiene su inverso para «Deshacer».
 */
import { DAY, instantToWall, wallToInstant } from './availability';
import type { Database } from './database.types';
import { cutRuleBefore, occurrencesBefore, shiftRuleDays, shiftWall, tailRule } from './recurrence';

export type EventRow = Database['public']['Tables']['availability_events']['Row'];
/** Columnas que un plan puede cambiar (la empresa y la sede de una fila no cambian). */
export type EventPatch = Partial<Omit<EventRow, 'id' | 'company_id' | 'branch_id' | 'created_at' | 'updated_at'>>;

export interface Plan {
  inserts: EventRow[];
  updates: { id: string; patch: EventPatch }[];
  deletes: string[];
}

export type Scope = 'this' | 'following' | 'all';

export const SCOPE_LABELS: Record<Scope, string> = {
  this: 'Este evento',
  following: 'Este y los siguientes',
  all: 'Todos los eventos',
};

/** Ocurrencia sobre la que actúa el usuario (instantes en ms). */
export interface OccurrenceRef {
  eventId: string;
  start: number;
  end: number;
  originalStart: number;
}

export const emptyPlan = (): Plan => ({ inserts: [], updates: [], deletes: [] });

const iso = (ms: number) => new Date(ms).toISOString();
const ms = (value: string) => Date.parse(value);

function byId(rows: readonly EventRow[], id: string): EventRow {
  const row = rows.find((r) => r.id === id);
  if (!row) throw new Error(`Evento ${id} no encontrado`);
  return row;
}

const childrenOf = (rows: readonly EventRow[], id: string) => rows.filter((r) => r.recurrence_parent_id === id);

/** ¿La ocurrencia es la primera de su serie? (entonces «este y los siguientes» = «todos»). */
export function isFirstOccurrence(row: EventRow, occ: OccurrenceRef): boolean {
  return occ.originalStart <= ms(row.starts_at);
}

/** Aplica el plan a una lista de filas (actualización optimista de la caché). */
export function applyPlan(rows: readonly EventRow[], plan: Plan): EventRow[] {
  // Mismo orden que la RPC: inserts, updates y luego deletes (con la cascada de la FK).
  const patches = new Map(plan.updates.map((u) => [u.id, u.patch]));
  const next = [...rows, ...plan.inserts].map((r) => (patches.has(r.id) ? { ...r, ...patches.get(r.id) } : r));
  const deleted = new Set(plan.deletes);
  for (const r of next) if (r.recurrence_parent_id && deleted.has(r.recurrence_parent_id)) deleted.add(r.id);
  return next.filter((r) => !deleted.has(r.id));
}

/** Plan inverso («Deshacer») a partir de las filas como estaban antes de aplicarlo. */
export function invertPlan(plan: Plan, before: readonly EventRow[]): Plan {
  const removed = new Set(plan.deletes);
  for (const r of before) if (r.recurrence_parent_id && removed.has(r.recurrence_parent_id)) removed.add(r.id);
  const restored = before.filter((r) => removed.has(r.id));
  // Las series antes que sus excepciones.
  restored.sort((a, b) => Number(!!a.recurrence_parent_id) - Number(!!b.recurrence_parent_id));
  return {
    inserts: restored,
    updates: plan.updates
      .filter((u) => !removed.has(u.id) && before.some((r) => r.id === u.id))
      .map((u) => {
        const row = byId(before, u.id);
        const patch: Record<string, unknown> = {};
        for (const key of Object.keys(u.patch)) patch[key] = row[key as keyof EventRow];
        return { id: u.id, patch: patch as EventPatch };
      }),
    deletes: plan.inserts.map((r) => r.id),
  };
}

/** Desfase de hora de pared y de días locales entre dos instantes, en la zona del evento. */
function wallDelta(from: number, to: number, tz: string) {
  const a = instantToWall(from, tz);
  const b = instantToWall(to, tz);
  return { wall: b - a, days: Math.floor(b / DAY) - Math.floor(a / DAY) };
}

/**
 * Cambia una ocurrencia. `change` puede traer `starts_at`/`ends_at` nuevos *de esa ocurrencia*
 * (mover, estirar o editar horas) y cualquier otro campo. Un evento suelto (o una excepción)
 * se actualiza tal cual; en una serie se aplica `scope`.
 */
export function planChange(
  rows: readonly EventRow[],
  occ: OccurrenceRef,
  scope: Scope,
  change: EventPatch,
  makeId: () => string,
): Plan {
  const row = byId(rows, occ.eventId);
  if (!row.rrule) return { inserts: [], updates: [{ id: row.id, patch: change }], deletes: [] };
  if (scope === 'all' || (scope === 'following' && isFirstOccurrence(row, occ))) return planAll(rows, row, occ, change);
  if (scope === 'this') return planThis(row, occ, change, makeId);
  return planFollowing(rows, row, occ, change, makeId);
}

function planAll(rows: readonly EventRow[], row: EventRow, occ: OccurrenceRef, change: EventPatch): Plan {
  const { starts_at: newStart, ends_at: newEnd, ...rest } = change;
  const patch: EventPatch = { ...rest };
  const updates: Plan['updates'] = [];
  if (newStart !== undefined || newEnd !== undefined) {
    const tz = row.timezone;
    const start = newStart ? ms(newStart) : occ.start;
    const end = newEnd ? ms(newEnd) : occ.end;
    const delta = wallDelta(occ.start, start, tz);
    const length = instantToWall(end, tz) - instantToWall(start, tz);
    const seriesStart = shiftWall(ms(row.starts_at), delta.wall, tz);
    patch.starts_at = iso(seriesStart);
    patch.ends_at = iso(wallToInstant(instantToWall(seriesStart, tz) + length, tz));
    if (delta.days !== 0 && rest.rrule === undefined) patch.rrule = shiftRuleDays(row.rrule!, delta.days);
    if (delta.wall !== 0) {
      // Las ocurrencias excluidas y las excepciones se mueven con la serie.
      patch.exdates = row.exdates.map((x) => iso(shiftWall(ms(x), delta.wall, tz)));
      for (const child of childrenOf(rows, row.id)) {
        updates.push({
          id: child.id,
          patch: { recurrence_original_start: iso(shiftWall(ms(child.recurrence_original_start!), delta.wall, tz)) },
        });
      }
    }
  }
  return { inserts: [], updates: [{ id: row.id, patch }, ...updates], deletes: [] };
}

function planThis(row: EventRow, occ: OccurrenceRef, change: EventPatch, makeId: () => string): Plan {
  // Una excepción es del mismo tipo que su serie (trigger): si cambia el tipo, queda suelta.
  const linked = change.kind === undefined || change.kind === row.kind;
  const { rrule: _ignored, ...rest } = change; // «solo este evento» nunca se repite
  void _ignored;
  const child: EventRow = {
    ...row,
    ...rest,
    id: makeId(),
    starts_at: change.starts_at ?? iso(occ.start),
    ends_at: change.ends_at ?? iso(occ.end),
    rrule: null,
    exdates: [],
    recurrence_parent_id: linked ? row.id : null,
    recurrence_original_start: linked ? iso(occ.originalStart) : null,
  };
  return {
    inserts: [child],
    updates: [{ id: row.id, patch: { exdates: [...row.exdates, iso(occ.originalStart)] } }],
    deletes: [],
  };
}

function planFollowing(
  rows: readonly EventRow[],
  row: EventRow,
  occ: OccurrenceRef,
  change: EventPatch,
  makeId: () => string,
): Plan {
  const tz = row.timezone;
  const seriesStart = ms(row.starts_at);
  const start = change.starts_at ? ms(change.starts_at) : occ.start;
  const end = change.ends_at ? ms(change.ends_at) : occ.end;
  const moved = start !== occ.start || end !== occ.end;
  const delta = wallDelta(occ.start, start, tz);
  const used = occurrencesBefore(row.rrule!, seriesStart, tz, occ.originalStart);
  const later = (x: string | null) => x !== null && ms(x) >= occ.originalStart;

  let rule = change.rrule !== undefined ? change.rrule : tailRule(row.rrule!, used);
  if (change.rrule === undefined && rule && delta.days !== 0) rule = shiftRuleDays(rule, delta.days);
  const tail: EventRow = {
    ...row,
    ...change,
    id: makeId(),
    starts_at: iso(start),
    ends_at: iso(end),
    rrule: rule,
    exdates: moved || !rule ? [] : row.exdates.filter(later),
    recurrence_parent_id: null,
    recurrence_original_start: null,
  };

  // Las excepciones posteriores pasan a la serie nueva si sus ocurrencias siguen existiendo.
  const keep = !moved && !!rule && (change.kind === undefined || change.kind === row.kind);
  const laterChildren = childrenOf(rows, row.id).filter((c) => later(c.recurrence_original_start));
  return {
    inserts: [tail],
    updates: [
      {
        id: row.id,
        patch: {
          rrule: cutRuleBefore(row.rrule!, seriesStart, occ.originalStart),
          exdates: row.exdates.filter((x) => !later(x)),
        },
      },
      ...(keep ? laterChildren.map((c) => ({ id: c.id, patch: { recurrence_parent_id: tail.id } })) : []),
    ],
    deletes: keep ? [] : laterChildren.map((c) => c.id),
  };
}

/** Borra una ocurrencia según `scope` (un evento suelto o una excepción se borra sin más). */
export function planDelete(rows: readonly EventRow[], occ: OccurrenceRef, scope: Scope): Plan {
  const row = byId(rows, occ.eventId);
  const children = childrenOf(rows, row.id);
  if (!row.rrule || scope === 'all' || (scope === 'following' && isFirstOccurrence(row, occ))) {
    // Las excepciones se listan explícitamente para que «Deshacer» las restaure.
    return { inserts: [], updates: [], deletes: [...children.map((c) => c.id), row.id] };
  }
  if (scope === 'this') {
    return {
      inserts: [],
      updates: [{ id: row.id, patch: { exdates: [...row.exdates, iso(occ.originalStart)] } }],
      deletes: [],
    };
  }
  const later = (x: string | null) => x !== null && ms(x) >= occ.originalStart;
  return {
    inserts: [],
    updates: [
      {
        id: row.id,
        patch: {
          rrule: cutRuleBefore(row.rrule, ms(row.starts_at), occ.originalStart),
          exdates: row.exdates.filter((x) => !later(x)),
        },
      },
    ],
    deletes: children.filter((c) => later(c.recurrence_original_start)).map((c) => c.id),
  };
}

/** Duplicar: copia sin vínculos de serie ni exclusiones. */
export function planDuplicate(rows: readonly EventRow[], occ: OccurrenceRef, makeId: () => string): Plan {
  const row = byId(rows, occ.eventId);
  const copy: EventRow = {
    ...row,
    id: makeId(),
    title: row.title ? `${row.title} (copia)`.slice(0, 200) : '',
    // Una serie se duplica entera (como Google); un evento suelto, con su horario.
    starts_at: row.rrule ? row.starts_at : iso(occ.start),
    ends_at: row.rrule ? row.ends_at : iso(occ.end),
    exdates: [],
    recurrence_parent_id: null,
    recurrence_original_start: null,
  };
  return { inserts: [copy], updates: [], deletes: [] };
}

/** Copia todas las filas a otra sede (al activar «horario propio»), con ids nuevos. */
export function planCopyTo(rows: readonly EventRow[], branchId: string, makeId: () => string): Plan {
  const ids = new Map(rows.map((r) => [r.id, makeId()]));
  const copies = rows.map((r) => ({
    ...r,
    id: ids.get(r.id)!,
    branch_id: branchId,
    recurrence_parent_id: r.recurrence_parent_id ? (ids.get(r.recurrence_parent_id) ?? null) : null,
  }));
  // Una excepción cuya serie no se copió queda suelta.
  for (const c of copies) if (!c.recurrence_parent_id) c.recurrence_original_start = null;
  copies.sort((a, b) => Number(!!a.recurrence_parent_id) - Number(!!b.recurrence_parent_id));
  return { inserts: copies, updates: [], deletes: [] };
}
