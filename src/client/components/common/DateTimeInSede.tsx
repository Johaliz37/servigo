import { formatInTimeZone } from '@shared/format';

/** Fecha/hora en la zona horaria de la sede (no la del navegador, 00 §6). */
export function DateTimeInSede({
  value,
  timeZone,
  pattern = 'd MMM yyyy, h:mm a',
}: {
  value: Date | string;
  timeZone: string;
  pattern?: string;
}) {
  const iso = new Date(value).toISOString();
  return (
    <time dateTime={iso} title={`${formatInTimeZone(value, timeZone, 'PPpp')} (${timeZone})`}>
      {formatInTimeZone(value, timeZone, pattern)}
    </time>
  );
}
