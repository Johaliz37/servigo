import { useState, type FormEvent } from 'react';
import { MailIcon, PhoneIcon, SearchIcon } from 'lucide-react';
import { BOOKING_CODE_REGEX, E164_REGEX, normalizeCode, type BookingSummary } from '@shared/booking';
import { Button } from '@client/components/ui/button';
import { Input } from '@client/components/ui/input';
import { Label } from '@client/components/ui/label';
import { messageOf } from '@client/lib/messages';
import { cn } from '@client/lib/utils';
import { lookupBookings } from './api';
import { PhoneField } from './PhoneField';
import { Turnstile } from './Turnstile';

type ContactKind = 'phone' | 'email';

/**
 * Búsqueda de reservas (fase 10 §4). «code»: código + teléfono o correo (deben coincidir).
 * «contact»: solo teléfono o correo. La respuesta no dice si los datos existen.
 */
export function LookupForm({
  mode,
  initialCode = '',
  hideCode = false,
  onResults,
}: {
  mode: 'code' | 'contact';
  initialCode?: string;
  hideCode?: boolean;
  onResults: (results: BookingSummary[]) => void;
}) {
  const [code, setCode] = useState(initialCode);
  const [kind, setKind] = useState<ContactKind>('phone');
  const [phone, setPhone] = useState<string | undefined>();
  const [email, setEmail] = useState('');
  const [turnstile, setTurnstile] = useState<string | null>(null);
  // Cambiar la clave remonta el widget para pedir un token nuevo tras cada búsqueda.
  const [widget, setWidget] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setEmpty(false);
    const normalized = normalizeCode(code);
    if (mode === 'code' && !BOOKING_CODE_REGEX.test(normalized))
      return setError('El código tiene 8 caracteres, como K7M2-9QXA.');
    if (kind === 'phone' && !(phone && E164_REGEX.test(phone))) return setError('Escribe un teléfono válido.');
    if (kind === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      return setError('Escribe un correo válido.');
    if (!turnstile) return;
    const contact = kind === 'phone' ? { phone: phone! } : { email: email.trim() };
    setBusy(true);
    try {
      const { results } =
        mode === 'code'
          ? await lookupBookings({ mode, code: normalized, contact, turnstile })
          : await lookupBookings({ mode, contact, turnstile });
      setEmpty(results.length === 0);
      onResults(results);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
      setTurnstile(null);
      setWidget((w) => w + 1);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="space-y-4">
      {mode === 'code' && !hideCode && (
        <div className="space-y-2">
          <Label htmlFor="lookup-code">Código de la reserva</Label>
          <Input
            id="lookup-code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="K7M2-9QXA"
            autoComplete="off"
            autoCapitalize="characters"
            className="font-mono tracking-widest uppercase"
            maxLength={12}
          />
        </div>
      )}

      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">{mode === 'code' ? 'Para verificar, tu' : 'Busca por'}</legend>
        <div className="inline-flex rounded-lg border p-0.5" role="radiogroup" aria-label="Tipo de contacto">
          {(['phone', 'email'] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => setKind(k)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm',
                kind === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {k === 'phone' ? (
                <PhoneIcon aria-hidden className="size-4" />
              ) : (
                <MailIcon aria-hidden className="size-4" />
              )}
              {k === 'phone' ? 'Teléfono' : 'Correo'}
            </button>
          ))}
        </div>
        {kind === 'phone' ? (
          <div className="space-y-2">
            <Label htmlFor="lookup-phone" className="sr-only">
              Teléfono
            </Label>
            <PhoneField id="lookup-phone" value={phone} onChange={setPhone} />
          </div>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="lookup-email" className="sr-only">
              Correo
            </Label>
            <Input
              id="lookup-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tu@correo.com"
            />
          </div>
        )}
      </fieldset>

      <Turnstile key={widget} onToken={setTurnstile} action="lookup" />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {empty && (
        <p role="status" className="rounded-lg bg-muted p-3 text-sm">
          Si existen reservas con esos datos, aparecerán aquí. Revisa que el {mode === 'code' ? 'código y el ' : ''}
          {kind === 'phone' ? 'teléfono' : 'correo'} sean los mismos con que reservaste.
        </p>
      )}
      <Button type="submit" className="w-full" disabled={busy || !turnstile}>
        <SearchIcon aria-hidden />
        {busy ? 'Buscando…' : turnstile ? 'Buscar' : 'Verificando…'}
      </Button>
    </form>
  );
}
