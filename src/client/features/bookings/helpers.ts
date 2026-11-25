import { wallToInstant } from '@shared/availability';
import { formatInTimeZone } from '@shared/format';
import { useMembership } from '@client/features/auth/membership';

/** Puede forzar un horario fuera de disponibilidad o lleno (la BD lo vuelve a exigir). */
export function useCanForce() {
  const { role } = useMembership();
  return role === 'owner' || role === 'admin' || role === 'platform_admin';
}

/** Valor de `<input type="datetime-local">` (hora de la sede) → instante ISO. */
export const fromLocalInput = (value: string, tz: string) =>
  new Date(wallToInstant(Date.parse(`${value}:00Z`), tz)).toISOString();

/** «mar 1 dic 2026, 9:00» en la zona de la sede. */
export const formatWhenShort = (iso: string, tz: string) => formatInTimeZone(iso, tz, 'EEE d MMM yyyy, H:mm');
/** «martes 1 de diciembre, 9:00» (mensajes al cliente). */
export const formatWhenLong = (iso: string, tz: string) => formatInTimeZone(iso, tz, "EEEE d 'de' MMMM, H:mm");
