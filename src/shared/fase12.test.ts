import { describe, expect, it } from 'vitest';
import type { AvailabilityEvent } from './availability';
import {
  bucketFor,
  combineOccupancy,
  delta,
  heatmapGrid,
  occupancy,
  previousRange,
  rangeInstants,
  resolveRange,
} from './dashboard';

describe('rangos', () => {
  const today = '2026-11-25';
  it('presets terminan hoy; «Este mes» desde el 1', () => {
    expect(resolveRange('today', today)).toEqual({ from: today, to: today });
    expect(resolveRange('7d', today)).toEqual({ from: '2026-11-19', to: today });
    expect(resolveRange('30d', today)).toEqual({ from: '2026-10-27', to: today });
    expect(resolveRange('month', today)).toEqual({ from: '2026-11-01', to: today });
  });

  it('personalizado: ordena y limita a 366 días', () => {
    expect(resolveRange('custom', today, { from: '2026-11-10', to: '2026-11-01' })).toEqual({
      from: '2026-11-01',
      to: '2026-11-10',
    });
    expect(resolveRange('custom', today, { from: '2020-01-01', to: '2026-11-25' }).from).toBe('2025-11-25');
  });

  it('periodo anterior de la misma duración, instantes en la zona y agrupación', () => {
    expect(previousRange({ from: '2026-11-19', to: '2026-11-25' })).toEqual({ from: '2026-11-12', to: '2026-11-18' });
    const r = rangeInstants({ from: '2026-11-25', to: '2026-11-25' }, 'America/Bogota');
    expect(new Date(r.from).toISOString()).toBe('2026-11-25T05:00:00.000Z');
    expect(r.to - r.from).toBe(86_400_000);
    expect(bucketFor({ from: '2026-11-01', to: '2026-11-30' })).toBe('day');
    expect(bucketFor({ from: '2026-08-01', to: '2026-11-25' })).toBe('week');
    expect(bucketFor({ from: '2026-01-01', to: '2026-11-25' })).toBe('month');
  });
});

describe('variación', () => {
  it('relativa al periodo anterior; sin base → null', () => {
    expect(delta(150, 100)).toEqual({ ratio: 0.5, direction: 'up' });
    expect(delta(50, 100)).toEqual({ ratio: -0.5, direction: 'down' });
    expect(delta(5, 0)).toEqual({ ratio: null, direction: 'up' });
    expect(delta(null, 10)).toEqual({ ratio: null, direction: 'flat' });
  });
});

describe('mapa de calor', () => {
  it('lunes primero y al menos 8–18 h', () => {
    const g = heatmapGrid([
      { dow: 1, hour: 10, count: 2 },
      { dow: 7, hour: 20, count: 1 },
    ]);
    expect(g.hours[0]).toBe(8);
    expect(g.hours.at(-1)).toBe(20);
    expect(g.rows[0]![2]).toBe(2);
    expect(g.rows[6]!.at(-1)).toBe(1);
    expect(g.max).toBe(2);
  });
});

describe('ocupación (motor de la fase 08)', () => {
  // Lunes 9:00–17:00 en Bogotá, semanal; semana del 7 ene. 2030.
  const open: AvailabilityEvent = {
    id: 'e1',
    kind: 'open',
    title: '',
    startsAt: '2030-01-07T14:00:00.000Z',
    endsAt: '2030-01-07T22:00:00.000Z',
    allDay: false,
    timezone: 'America/Bogota',
    rrule: 'FREQ=WEEKLY;BYDAY=MO',
    exdates: [],
    recurrenceParentId: null,
    recurrenceOriginalStart: null,
    serviceIds: null,
    capacityOverride: null,
  };
  const week = rangeInstants({ from: '2030-01-07', to: '2030-01-13' }, 'America/Bogota');

  it('reservado / ofrecido por servicio y sede; las canceladas no cuentan', () => {
    const result = occupancy({
      events: [open],
      services: [
        { id: 'corte', name: 'Corte', capacity: 1 },
        { id: 'grupal', name: 'Clase', capacity: 4 },
      ],
      bookings: [
        {
          service_id: 'corte',
          block_starts_at: '2030-01-07T14:00:00Z',
          block_ends_at: '2030-01-07T15:00:00Z',
          status: 'completed',
        },
        {
          service_id: 'corte',
          block_starts_at: '2030-01-07T15:00:00Z',
          block_ends_at: '2030-01-07T16:00:00Z',
          status: 'cancelled',
        },
        {
          service_id: 'grupal',
          block_starts_at: '2030-01-07T16:00:00Z',
          block_ends_at: '2030-01-07T18:00:00Z',
          status: 'no_show',
        },
      ],
      from: week.from,
      to: week.to,
      timezone: 'America/Bogota',
    });
    expect(result.byService[0]).toMatchObject({ offered: 480, booked: 60, rate: 0.125 });
    expect(result.byService[1]).toMatchObject({ offered: 1920, booked: 120, rate: 0.0625 });
    // Sede: 8 h × capacidad máxima 4 = 1.920 min; reservado 180.
    expect(result.total).toEqual({ offered: 1920, booked: 180, rate: 180 / 1920 });
  });

  it('rangos de más de 31 días se calculan en tramos; sin oferta → null', () => {
    const long = rangeInstants({ from: '2030-01-07', to: '2030-03-03' }, 'America/Bogota'); // 8 semanas
    const r = occupancy({
      events: [open],
      services: [{ id: 's', name: 'S', capacity: 1 }],
      bookings: [],
      from: long.from,
      to: long.to,
      timezone: 'America/Bogota',
    });
    expect(r.total.offered).toBe(8 * 480);
    expect(
      occupancy({
        events: [],
        services: [{ id: 's', name: 'S', capacity: 1 }],
        bookings: [],
        from: week.from,
        to: week.to,
        timezone: 'UTC',
      }).total.rate,
    ).toBeNull();
    expect(
      combineOccupancy([
        { offered: 100, booked: 10, rate: 0.1 },
        { offered: 300, booked: 90, rate: 0.3 },
      ]).rate,
    ).toBe(0.25);
  });
});
