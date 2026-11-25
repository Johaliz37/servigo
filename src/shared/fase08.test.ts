import { describe, expect, it } from 'vitest';
import {
  computeSlots,
  dayStartInstant,
  expandEvents,
  instantToWall,
  localDate,
  rruleWalls,
  seriesWalls,
  subtractIntervals,
  toSlotQuery,
  unionIntervals,
  wallToInstant,
  type AvailabilityEvent,
  type SlotBooking,
  type SlotQuery,
} from './availability';
import { colombianHolidays, easterSunday } from './holidays/co';
import {
  buildRule,
  cutRuleBefore,
  defaultCustom,
  describeRule,
  isValidRule,
  occurrencesBefore,
  parseRule,
  repeatOptions,
  shiftRuleDays,
  shiftWall,
  tailRule,
  toRruleUtc,
  weekdayOf,
} from './recurrence';

const BOG = 'America/Bogota';
const at = (local: string, tz = BOG) => new Date(wallToInstant(Date.parse(`${local}:00Z`), tz));
const hhmm = (iso: string, tz = BOG) => new Date(instantToWall(Date.parse(iso), tz)).toISOString().slice(11, 16);

let seq = 0;
function ev(partial: Partial<AvailabilityEvent> & { start: string; end: string; tz?: string }): AvailabilityEvent {
  const tz = partial.tz ?? BOG;
  return {
    id: partial.id ?? `e${++seq}`,
    kind: partial.kind ?? 'open',
    title: partial.title ?? '',
    startsAt: at(partial.start, tz).toISOString(),
    endsAt: at(partial.end, tz).toISOString(),
    allDay: partial.allDay ?? false,
    timezone: tz,
    rrule: partial.rrule ?? null,
    exdates: partial.exdates ?? [],
    recurrenceParentId: partial.recurrenceParentId ?? null,
    recurrenceOriginalStart: partial.recurrenceOriginalStart ?? null,
    serviceIds: partial.serviceIds ?? null,
    capacityOverride: partial.capacityOverride ?? null,
  };
}

const SERVICE = { id: 'svc', durationMinutes: 45, bufferBefore: 0, bufferAfter: 0, capacity: 1 };

function query(over: Partial<SlotQuery> & { from: string; to: string; tz?: string }): SlotQuery {
  const tz = over.tz ?? over.timezone ?? BOG;
  return {
    timezone: tz,
    range: { from: at(over.from, tz), to: at(over.to, tz) },
    service: over.service ?? SERVICE,
    events: over.events ?? [],
    bookings: over.bookings ?? [],
    settings: over.settings ?? { slotStepMinutes: 30, minLeadMinutes: 0, maxDaysAhead: 365 },
    now: over.now ?? new Date('2026-01-01T00:00:00Z'),
  };
}

const times = (q: SlotQuery) =>
  computeSlots(q).map((d) => ({ date: d.date, slots: d.slots.map((s) => hhmm(s.start, q.timezone)) }));

describe('hora de pared', () => {
  it('ida y vuelta, y días locales', () => {
    const ms = Date.parse('2026-11-25T14:00:00Z');
    expect(wallToInstant(instantToWall(ms, BOG), BOG)).toBe(ms);
    expect(new Date(instantToWall(ms, BOG)).toISOString()).toBe('2026-11-25T09:00:00.000Z');
    expect(localDate(Date.parse('2026-11-26T04:59:00Z'), BOG)).toBe('2026-11-25');
    expect(new Date(dayStartInstant('2026-11-25', BOG)).toISOString()).toBe('2026-11-25T05:00:00.000Z');
  });

  it('hora inexistente avanza con el salto; ambigua toma la primera', () => {
    // Madrid: 29-mar-2026 02:00 → 03:00; 25-oct-2026 03:00 → 02:00.
    const gap = wallToInstant(Date.parse('2026-03-29T02:30:00Z'), 'Europe/Madrid');
    expect(new Date(gap).toISOString()).toBe('2026-03-29T01:30:00.000Z'); // = 03:30 CEST
    const amb = wallToInstant(Date.parse('2026-10-25T02:30:00Z'), 'Europe/Madrid');
    expect(new Date(amb).toISOString()).toBe('2026-10-25T00:30:00.000Z'); // 02:30 CEST (la primera)
  });
});

describe('intervalos', () => {
  it('une y resta', () => {
    expect(
      unionIntervals([
        [5, 7],
        [1, 3],
        [3, 4],
        [6, 9],
      ]),
    ).toEqual([
      [1, 4],
      [5, 9],
    ]);
    expect(
      subtractIntervals(
        [
          [0, 10],
          [20, 30],
        ],
        [
          [2, 3],
          [5, 22],
          [29, 40],
        ],
      ),
    ).toEqual([
      [0, 2],
      [3, 5],
      [22, 29],
    ]);
    expect(subtractIntervals([[0, 10]], [])).toEqual([[0, 10]]);
  });
});

describe('expandEvents', () => {
  it('serie semanal con exdates y una excepción que la reemplaza', () => {
    const series = ev({ id: 's', start: '2026-11-02T09:00', end: '2026-11-02T10:00', rrule: 'FREQ=WEEKLY;BYDAY=MO' });
    series.exdates = [at('2026-11-09T09:00').toISOString()];
    const child = ev({
      id: 'c',
      start: '2026-11-17T15:00',
      end: '2026-11-17T16:00',
      recurrenceParentId: 's',
      recurrenceOriginalStart: at('2026-11-16T09:00').toISOString(),
    });
    const occ = expandEvents([series, child], at('2026-11-01T00:00').getTime(), at('2026-11-30T00:00').getTime());
    expect(occ.map((o) => `${localDate(o.start, BOG)} ${hhmm(new Date(o.start).toISOString())} ${o.seriesId}`)).toEqual(
      ['2026-11-02 09:00 s', '2026-11-17 15:00 s', '2026-11-23 09:00 s'],
    );
  });

  it('una regla ilegible se ignora sin romper el cálculo', () => {
    const bad = ev({ start: '2026-11-02T09:00', end: '2026-11-02T10:00', rrule: 'FREQ=WEEKLY;UNTIL=mañana' });
    const ok = ev({ start: '2026-11-02T09:00', end: '2026-11-02T10:00' });
    expect(expandEvents([bad, ok], 0, Date.parse('2027-01-01T00:00:00Z'))).toHaveLength(1);
  });

  it('COUNT y UNTIL (en UTC) se respetan', () => {
    const count = ev({ start: '2026-11-02T09:00', end: '2026-11-02T10:00', rrule: 'FREQ=DAILY;COUNT=3' });
    const until = ev({
      start: '2026-11-02T09:00',
      end: '2026-11-02T10:00',
      // hasta el 4-nov 23:59:59 de Bogotá = 5-nov 04:59:59Z
      rrule: 'FREQ=DAILY;UNTIL=20261105T045959Z',
    });
    const range = [at('2026-11-01T00:00').getTime(), at('2026-11-30T00:00').getTime()] as const;
    expect(expandEvents([count], ...range)).toHaveLength(3);
    expect(expandEvents([until], ...range).map((o) => localDate(o.start, BOG))).toEqual([
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
    ]);
  });

  it('evento de todo el día se ancla a la zona de la sede', () => {
    const holiday = ev({ kind: 'closed', allDay: true, start: '2026-12-25T00:00', end: '2026-12-26T00:00' });
    const [o] = expandEvents([holiday], 0, Date.parse('2027-01-01T00:00:00Z'), 'Europe/Madrid');
    expect(new Date(o!.start).toISOString()).toBe('2026-12-24T23:00:00.000Z');
    expect(o!.end - o!.start).toBe(86_400_000);
  });
});

describe('vía rápida de expansión = rrule', () => {
  it('300 reglas diarias/semanales aleatorias dan las mismas fechas', () => {
    let seed = 42;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    const codes = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
    for (let i = 0; i < 300; i++) {
      const tz = i % 2 ? 'Europe/Madrid' : BOG;
      const freq = rnd(2) ? 'DAILY' : 'WEEKLY';
      const parts = [`FREQ=${freq}`];
      const interval = 1 + rnd(3);
      if (interval > 1) parts.push(`INTERVAL=${interval}`);
      if (rnd(3)) parts.push(`BYDAY=${codes.filter(() => rnd(2)).join(',') || 'MO'}`);
      const end = rnd(3);
      const wallStart = Date.UTC(2026, rnd(12), 1 + rnd(28), 6 + rnd(12), rnd(4) * 15);
      if (end === 1) parts.push(`COUNT=${1 + rnd(40)}`);
      if (end === 2) parts.push(`UNTIL=${toRruleUtc(wallStart + rnd(200) * 86_400_000)}`);
      const rule = parts.join(';');
      const from = wallStart + (rnd(120) - 20) * 86_400_000;
      const to = from + (1 + rnd(40)) * 86_400_000;
      expect(seriesWalls(rule, wallStart, tz, from, to), rule).toEqual(rruleWalls(rule, wallStart, tz, from, to));
    }
  });

  it('las reglas que no son simples usan rrule', () => {
    const start = Date.UTC(2026, 0, 31, 9);
    const rule = 'FREQ=MONTHLY;BYMONTHDAY=-1';
    const walls = seriesWalls(rule, start, BOG, start, Date.UTC(2026, 4, 1));
    expect(walls.map((w) => new Date(w).toISOString().slice(0, 10))).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
    expect(seriesWalls('FREQ=WEEKLY;BYDAY=1MO', start, BOG, start, Date.UTC(2026, 2, 1))).toEqual(
      rruleWalls('FREQ=WEEKLY;BYDAY=1MO', start, BOG, start, Date.UTC(2026, 2, 1)),
    );
  });
});

describe('computeSlots', () => {
  // L–V 8:00–17:00 + almuerzo 12–13 + festivo; servicio de 45 min con paso de 30 (criterio de aceptación).
  const office = ev({ start: '2026-11-02T08:00', end: '2026-11-02T17:00', rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' });
  const lunch = ev({
    kind: 'closed',
    start: '2026-11-02T12:00',
    end: '2026-11-02T13:00',
    rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
  });
  const holiday = ev({ kind: 'closed', allDay: true, start: '2026-11-16T00:00', end: '2026-11-17T00:00' });

  it('oficina + almuerzo + festivo', () => {
    const result = times(query({ from: '2026-11-13T00:00', to: '2026-11-18T00:00', events: [office, lunch, holiday] }));
    const expected = [
      '08:00',
      '08:30',
      '09:00',
      '09:30',
      '10:00',
      '10:30',
      '11:00',
      '13:00',
      '13:30',
      '14:00',
      '14:30',
      '15:00',
      '15:30',
      '16:00',
    ];
    expect(result).toEqual([
      { date: '2026-11-13', slots: expected },
      // sábado, domingo y el lunes festivo sin cupos
      { date: '2026-11-17', slots: expected },
    ]);
  });

  it('un closed que parte la ventana en dos', () => {
    const open = ev({ start: '2026-11-18T09:00', end: '2026-11-18T12:00' });
    const gap = ev({ kind: 'closed', start: '2026-11-18T10:00', end: '2026-11-18T10:30' });
    const q = query({
      from: '2026-11-18T00:00',
      to: '2026-11-19T00:00',
      events: [open, gap],
      service: { ...SERVICE, durationMinutes: 30 },
    });
    expect(times(q)[0]!.slots).toEqual(['09:00', '09:30', '10:30', '11:00', '11:30']);
  });

  it('evento que cruza medianoche', () => {
    const night = ev({ start: '2026-11-20T22:00', end: '2026-11-21T02:00' });
    const q = query({
      from: '2026-11-20T00:00',
      to: '2026-11-22T00:00',
      events: [night],
      service: { ...SERVICE, durationMinutes: 60 },
      settings: { slotStepMinutes: 60, minLeadMinutes: 0, maxDaysAhead: 365 },
    });
    expect(times(q)).toEqual([
      { date: '2026-11-20', slots: ['22:00', '23:00'] },
      { date: '2026-11-21', slots: ['00:00', '01:00'] },
    ]);
  });

  it('cambio de hora (Santiago y Madrid): la serie sigue a la misma hora local', () => {
    for (const [tz, before, after] of [
      ['America/Santiago', '2026-09-04', '2026-09-07'], // Chile adelanta la hora el 6-sep-2026
      ['Europe/Madrid', '2026-03-27', '2026-03-30'],
    ] as const) {
      const daily = ev({ tz, start: `${before}T09:00`, end: `${before}T11:00`, rrule: 'FREQ=DAILY' });
      const q = query({
        tz,
        from: `${before}T00:00`,
        to: `${after}T23:00`,
        events: [daily],
        service: { ...SERVICE, durationMinutes: 60 },
        settings: { slotStepMinutes: 60, minLeadMinutes: 0, maxDaysAhead: 365 },
      });
      const days = times(q);
      expect(days).toHaveLength(4);
      for (const d of days) expect(d.slots).toEqual(['09:00', '10:00']);
      // y el instante UTC sí cambia una hora
      const first = computeSlots(q)[0]!.slots[0]!.start;
      const last = computeSlots(q)[3]!.slots[0]!.start;
      expect(Math.abs(((Date.parse(last) - Date.parse(first)) % 86_400_000) / 3_600_000)).toBe(23);
    }
  });

  it('excepción de una ocurrencia y serie cortada («este y los siguientes»)', () => {
    const tue = ev({ id: 'tue', start: '2026-11-03T09:00', end: '2026-11-03T10:00', rrule: 'FREQ=WEEKLY;BYDAY=TU' });
    const seriesStart = Date.parse(tue.startsAt);
    // «Solo este evento» el 10-nov: pasa a las 15:00.
    tue.exdates = [at('2026-11-10T09:00').toISOString()];
    const moved = ev({
      start: '2026-11-10T15:00',
      end: '2026-11-10T16:00',
      recurrenceParentId: 'tue',
      recurrenceOriginalStart: at('2026-11-10T09:00').toISOString(),
    });
    // «Este y los siguientes» desde el 24-nov: la serie se corta y sigue otra a las 11:00.
    tue.rrule = cutRuleBefore(tue.rrule!, seriesStart, at('2026-11-24T09:00').getTime());
    const tail = ev({ start: '2026-11-24T11:00', end: '2026-11-24T12:00', rrule: 'FREQ=WEEKLY;BYDAY=TU' });
    const q = query({
      from: '2026-11-01T00:00',
      to: '2026-12-02T00:00',
      events: [tue, moved, tail],
      service: { ...SERVICE, durationMinutes: 60 },
      settings: { slotStepMinutes: 60, minLeadMinutes: 0, maxDaysAhead: 365 },
    });
    expect(times(q)).toEqual([
      { date: '2026-11-03', slots: ['09:00'] },
      { date: '2026-11-10', slots: ['15:00'] },
      { date: '2026-11-17', slots: ['09:00'] },
      { date: '2026-11-24', slots: ['11:00'] },
      { date: '2026-12-01', slots: ['11:00'] },
    ]);
  });

  it('capacidad 3 con 2 reservas → remaining 1; la cancelada no cuenta; otro servicio tampoco', () => {
    const open = ev({ start: '2026-11-18T09:00', end: '2026-11-18T10:00' });
    const block = (status: SlotBooking['status'], serviceId = 'svc'): SlotBooking => ({
      blockStart: at('2026-11-18T09:00'),
      blockEnd: at('2026-11-18T10:00'),
      serviceId,
      status,
    });
    const q = query({
      from: '2026-11-18T00:00',
      to: '2026-11-19T00:00',
      events: [open],
      service: { ...SERVICE, durationMinutes: 60, capacity: 3 },
      bookings: [block('confirmed'), block('pending'), block('cancelled'), block('confirmed', 'otro')],
    });
    expect(computeSlots(q)[0]!.slots).toEqual([
      { start: at('2026-11-18T09:00').toISOString(), end: at('2026-11-18T10:00').toISOString(), remaining: 1 },
    ]);
    // Con una reserva más, ya no hay cupo.
    expect(computeSlots({ ...q, bookings: [...q.bookings, block('confirmed')] })).toEqual([]);
    // capacity_override de la ventana manda sobre la del servicio.
    open.capacityOverride = 5;
    expect(computeSlots(q)[0]!.slots[0]!.remaining).toBe(3);
  });

  it('los buffers impiden un cupo pegado al cierre (y a la apertura)', () => {
    const open = ev({ start: '2026-11-18T09:00', end: '2026-11-18T11:00' });
    const q = query({
      from: '2026-11-18T00:00',
      to: '2026-11-19T00:00',
      events: [open],
      service: { ...SERVICE, durationMinutes: 60, bufferBefore: 10, bufferAfter: 15 },
    });
    // 9:00 no (buffer antes sale de la ventana); 10:00 no (buffer después pasa de 11:00).
    expect(times(q)[0]!.slots).toEqual(['09:30']);
  });

  it('las reservas con buffers bloquean los cupos vecinos', () => {
    const open = ev({ start: '2026-11-18T09:00', end: '2026-11-18T12:00' });
    const q = query({
      from: '2026-11-18T00:00',
      to: '2026-11-19T00:00',
      events: [open],
      service: { ...SERVICE, durationMinutes: 30, bufferAfter: 30 },
      bookings: [
        { blockStart: at('2026-11-18T10:00'), blockEnd: at('2026-11-18T11:00'), serviceId: 'svc', status: 'pending' },
      ],
    });
    expect(times(q)[0]!.slots).toEqual(['09:00', '11:00']);
  });

  it('antelación mínima, máximo de días y filtro por servicio', () => {
    const open = ev({ start: '2026-11-18T09:00', end: '2026-11-18T12:00', rrule: 'FREQ=DAILY' });
    const other = ev({ start: '2026-11-18T14:00', end: '2026-11-18T16:00', rrule: 'FREQ=DAILY', serviceIds: ['otro'] });
    const q = query({
      from: '2026-11-18T00:00',
      to: '2026-11-25T00:00',
      events: [open, other],
      now: at('2026-11-18T09:10'),
      settings: { slotStepMinutes: 60, minLeadMinutes: 60, maxDaysAhead: 2 },
      service: { ...SERVICE, durationMinutes: 60 },
    });
    expect(times(q)).toEqual([
      { date: '2026-11-18', slots: ['11:00'] },
      { date: '2026-11-19', slots: ['09:00', '10:00', '11:00'] },
      { date: '2026-11-20', slots: ['09:00'] }, // hasta now + 2 días (9:10)
    ]);
  });

  it('paso que no divide el día se realinea a medianoche; rango vacío o excesivo', () => {
    const open = ev({ start: '2026-11-18T00:00', end: '2026-11-19T02:00' });
    const q = query({
      from: '2026-11-18T22:00',
      to: '2026-11-19T03:00',
      events: [open],
      service: { ...SERVICE, durationMinutes: 30 },
      settings: { slotStepMinutes: 50, minLeadMinutes: 0, maxDaysAhead: 365 },
    });
    expect(times(q)).toEqual([
      { date: '2026-11-18', slots: ['22:30', '23:20'] },
      { date: '2026-11-19', slots: ['00:00', '00:50'] },
    ]);
    expect(computeSlots({ ...q, range: { from: q.range.to, to: q.range.from } })).toEqual([]);
    expect(() => computeSlots({ ...q, range: { from: new Date('2026-01-01'), to: new Date('2026-03-01') } })).toThrow(
      RangeError,
    );
  });

  it('rendimiento: 31 días, 20 eventos y 500 reservas en menos de 5 ms', () => {
    const events: AvailabilityEvent[] = [];
    for (let i = 0; i < 20; i++) {
      const kind = i % 4 === 3 ? 'closed' : 'open';
      const h = String(7 + (i % 10)).padStart(2, '0');
      events.push(
        ev({
          kind,
          start: `2026-01-0${1 + (i % 7)}T${h}:00`,
          end: `2026-01-0${1 + (i % 7)}T${h}:45`,
          rrule: i % 2 ? 'FREQ=WEEKLY;BYDAY=MO,WE,FR' : 'FREQ=DAILY',
        }),
      );
    }
    events.push(ev({ start: '2026-01-01T06:00', end: '2026-01-01T22:00', rrule: 'FREQ=DAILY' }));
    const bookings: SlotBooking[] = Array.from({ length: 500 }, (_, i) => {
      const start = at('2026-11-01T06:00').getTime() + (i % 31) * 86_400_000 + (i % 16) * 3_600_000;
      return {
        blockStart: new Date(start),
        blockEnd: new Date(start + 3_600_000),
        serviceId: 'svc',
        status: 'confirmed',
      };
    });
    const q = query({
      from: '2026-11-01T00:00',
      to: '2026-12-02T00:00',
      events,
      bookings,
      service: { ...SERVICE, capacity: 3 },
      settings: { slotStepMinutes: 15, minLeadMinutes: 0, maxDaysAhead: 365 },
    });
    for (let i = 0; i < 5; i++) computeSlots(q); // calentamiento (JIT y caché de zonas)
    // Mejor de 20 corridas: con la suite en paralelo (y la cobertura de la CI) el ruido de CPU solo
    // suma tiempo; el mínimo es el coste propio del motor.
    const samples = Array.from({ length: 20 }, () => {
      const t0 = performance.now();
      computeSlots(q);
      return performance.now() - t0;
    });
    expect(computeSlots(q).length).toBe(31);
    expect(Math.min(...samples)).toBeLessThan(5);
  });

  it('toSlotQuery adapta la salida de get_slot_inputs', () => {
    const q = toSlotQuery(
      {
        company_id: 'c',
        branch_id: 'b',
        timezone: BOG,
        settings: { slot_step_minutes: 15 },
        service: { id: 'svc', duration_minutes: 30, buffer_before_minutes: 5, buffer_after_minutes: 0, capacity: 2 },
        events: [
          {
            id: 'x',
            kind: 'open',
            starts_at: '2026-11-18T14:00:00Z',
            ends_at: '2026-11-18T15:00:00Z',
            all_day: false,
            timezone: BOG,
            rrule: null,
            exdates: null,
            recurrence_parent_id: null,
            recurrence_original_start: null,
            service_ids: null,
            capacity_override: null,
          },
        ],
        bookings: [{ block_starts_at: 'a', block_ends_at: 'b', service_id: 'svc', status: 'pending' }],
      },
      { from: new Date('2026-11-18T05:00:00Z'), to: new Date('2026-11-19T05:00:00Z') },
      new Date('2026-11-01T00:00:00Z'),
    );
    expect(q.settings).toEqual({ slotStepMinutes: 15, minLeadMinutes: 60, maxDaysAhead: 60 });
    expect(q.service).toEqual({ id: 'svc', durationMinutes: 30, bufferBefore: 5, bufferAfter: 0, capacity: 2 });
    expect(q.events[0]!.exdates).toEqual([]);
    expect(q.bookings[0]).toEqual({ blockStart: 'a', blockEnd: 'b', serviceId: 'svc', status: 'pending' });
    expect(times(q)[0]!.slots).toEqual(['09:15', '09:30']);
  });
});

describe('recurrencias', () => {
  const date = '2026-11-24'; // martes

  it('opciones de Repetir y presets ↔ RRULE', () => {
    expect(weekdayOf(date)).toBe('TU');
    expect(repeatOptions(date).map((o) => o.label)).toEqual([
      'No se repite',
      'Cada día',
      'Cada semana el martes',
      'Cada mes el día 24',
      'Cada año el 24 de noviembre',
      'Todos los días laborables (lun–vie)',
      'Personalizado…',
    ]);
    const custom = defaultCustom(date);
    for (const preset of ['daily', 'weekly', 'monthly', 'yearly', 'weekdays'] as const) {
      const rule = buildRule(preset, custom, date, BOG)!;
      expect(isValidRule(rule)).toBe(true);
      expect(parseRule(rule, date, BOG).preset).toBe(preset);
    }
    expect(buildRule('none', custom, date, BOG)).toBeNull();
    expect(parseRule(null, date, BOG).preset).toBe('none');
  });

  it('personalizado: intervalo, días y final', () => {
    const rule = buildRule(
      'custom',
      { freq: 'WEEKLY', interval: 2, byDay: ['FR', 'MO'], end: { type: 'until', date: '2026-12-31' } },
      date,
      BOG,
    )!;
    expect(rule).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR;UNTIL=20270101T045959Z');
    const parsed = parseRule(rule, date, BOG);
    expect(parsed.preset).toBe('custom');
    expect(parsed.custom).toEqual({
      freq: 'WEEKLY',
      interval: 2,
      byDay: ['MO', 'FR'],
      end: { type: 'until', date: '2026-12-31' },
    });
    expect(describeRule(rule, date, BOG)).toBe('Cada 2 semanas el lunes y viernes, hasta el 31 de diciembre de 2026');
    expect(
      buildRule('custom', { freq: 'DAILY', interval: 3, byDay: [], end: { type: 'count', count: 10 } }, date, BOG),
    ).toBe('FREQ=DAILY;INTERVAL=3;COUNT=10');
    expect(isValidRule('FREQ=HOURLY')).toBe(false);
    expect(isValidRule('FREQ=WEEKLY;BYDAY=XX')).toBe(false);
  });

  it('textos legibles', () => {
    expect(describeRule(null, date, BOG)).toBe('No se repite');
    expect(describeRule('FREQ=DAILY;COUNT=1', date, BOG)).toBe('Cada día, 1 vez');
    expect(describeRule('FREQ=DAILY;INTERVAL=2;COUNT=5', date, BOG)).toBe('Cada 2 días, 5 veces');
    expect(describeRule('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', date, BOG)).toBe('Todos los días laborables (lun–vie)');
    expect(describeRule('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU', date, BOG)).toBe('Cada día');
    expect(describeRule('FREQ=WEEKLY;BYDAY=MO,WE,SA', date, BOG)).toBe('Cada semana el lunes, miércoles y sábado');
    expect(describeRule('FREQ=MONTHLY;INTERVAL=3', date, BOG)).toBe('Cada 3 meses el día 24');
    expect(describeRule('FREQ=YEARLY', date, BOG)).toBe('Cada año el 24 de noviembre');
    expect(describeRule('FREQ=YEARLY;INTERVAL=2', date, BOG)).toBe('Cada 2 años el 24 de noviembre');
    expect(describeRule('FREQ=SECONDLY', date, BOG)).toBe('Se repite');
  });

  it('cortar la serie y descontar COUNT', () => {
    const start = at('2026-11-03T09:00').getTime();
    const occ = at('2026-11-17T09:00').getTime();
    expect(cutRuleBefore('FREQ=WEEKLY;BYDAY=TU;COUNT=5', start, start)).toBeNull();
    expect(cutRuleBefore('FREQ=WEEKLY;BYDAY=TU;COUNT=5', start, occ)).toBe(
      'FREQ=WEEKLY;BYDAY=TU;UNTIL=20261117T135959Z',
    );
    const used = occurrencesBefore('FREQ=WEEKLY;BYDAY=TU;COUNT=5', start, BOG, occ);
    expect(used).toBe(2);
    expect(tailRule('FREQ=WEEKLY;BYDAY=TU;COUNT=5', used)).toBe('FREQ=WEEKLY;BYDAY=TU;COUNT=3');
    expect(tailRule('FREQ=DAILY', 4)).toBe('FREQ=DAILY');
  });

  it('mover la serie gira los BYDAY y conserva la hora local', () => {
    expect(shiftRuleDays('FREQ=WEEKLY;BYDAY=MO,FR', 1)).toBe('FREQ=WEEKLY;BYDAY=TU,SA');
    expect(shiftRuleDays('FREQ=WEEKLY;BYDAY=MO', -1)).toBe('FREQ=WEEKLY;BYDAY=SU');
    expect(shiftRuleDays('FREQ=WEEKLY;BYDAY=MO', 7)).toBe('FREQ=WEEKLY;BYDAY=MO');
    expect(shiftRuleDays('FREQ=DAILY', 2)).toBe('FREQ=DAILY');
    const madrid = 'Europe/Madrid';
    const before = wallToInstant(Date.parse('2026-03-28T09:00:00Z'), madrid);
    const after = shiftWall(before, 86_400_000, madrid);
    expect(new Date(instantToWall(after, madrid)).toISOString()).toBe('2026-03-29T09:00:00.000Z');
  });
});

describe('festivos de Colombia', () => {
  it('2026 completo (Ley Emiliani)', () => {
    expect(new Date(easterSunday(2026)).toISOString().slice(0, 10)).toBe('2026-04-05');
    expect(new Date(easterSunday(2027)).toISOString().slice(0, 10)).toBe('2027-03-28');
    expect(colombianHolidays(2026).map((h) => h.date)).toEqual([
      '2026-01-01',
      '2026-01-12',
      '2026-03-23',
      '2026-04-02',
      '2026-04-03',
      '2026-05-01',
      '2026-05-18',
      '2026-06-08',
      '2026-06-15',
      '2026-06-29',
      '2026-07-20',
      '2026-08-07',
      '2026-08-17',
      '2026-10-12',
      '2026-11-02',
      '2026-11-16',
      '2026-12-08',
      '2026-12-25',
    ]);
  });
});
