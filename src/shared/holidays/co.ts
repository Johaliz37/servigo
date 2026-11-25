/**
 * Festivos de Colombia (Ley 51 de 1983, «Ley Emiliani»), calculados sin API: fechas fijas,
 * fechas que se trasladan al lunes siguiente y las que dependen de la Pascua.
 */

export interface Holiday {
  date: string; // YYYY-MM-DD
  name: string;
}

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const DAY = 86_400_000;

/** Domingo de Pascua (algoritmo anónimo gregoriano). */
export function easterSunday(year: number): number {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(year, month - 1, day);
}

/** Traslada al lunes siguiente (si ya es lunes, se queda). */
function nextMonday(ms: number): number {
  const dow = new Date(ms).getUTCDay(); // 0 = domingo
  return ms + ((8 - dow) % 7) * DAY;
}

export function colombianHolidays(year: number): Holiday[] {
  const fixed = (m: number, d: number) => Date.UTC(year, m - 1, d);
  const easter = easterSunday(year);
  const list: [number, string][] = [
    [fixed(1, 1), 'Año Nuevo'],
    [nextMonday(fixed(1, 6)), 'Día de los Reyes Magos'],
    [nextMonday(fixed(3, 19)), 'Día de San José'],
    [easter - 3 * DAY, 'Jueves Santo'],
    [easter - 2 * DAY, 'Viernes Santo'],
    [fixed(5, 1), 'Día del Trabajo'],
    [nextMonday(easter + 39 * DAY), 'Ascensión del Señor'],
    [nextMonday(easter + 60 * DAY), 'Corpus Christi'],
    [nextMonday(easter + 68 * DAY), 'Sagrado Corazón'],
    [nextMonday(fixed(6, 29)), 'San Pedro y San Pablo'],
    [fixed(7, 20), 'Día de la Independencia'],
    [fixed(8, 7), 'Batalla de Boyacá'],
    [nextMonday(fixed(8, 15)), 'La Asunción de la Virgen'],
    [nextMonday(fixed(10, 12)), 'Día de la Raza'],
    [nextMonday(fixed(11, 1)), 'Todos los Santos'],
    [nextMonday(fixed(11, 11)), 'Independencia de Cartagena'],
    [fixed(12, 8), 'Día de la Inmaculada Concepción'],
    [fixed(12, 25), 'Navidad'],
  ];
  return list.map(([ms, name]) => ({ date: iso(ms), name })).sort((a, b) => a.date.localeCompare(b.date));
}
