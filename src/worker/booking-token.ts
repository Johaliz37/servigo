/**
 * Token de acceso a una reserva (fase 10 §2): `/reserva/:code?t=…` muestra el detalle sin
 * volver a pedir el teléfono. `exp.firma`, con firma HMAC-SHA256 de empresa, código, teléfono
 * y vencimiento (30 días). Cambiar el teléfono de la reserva invalida los tokens anteriores.
 *
 * La clave se deriva de la secret key de Supabase (no hay un secreto más que mantener):
 * rotarla invalida los tokens emitidos, y el cliente vuelve a entrar con su teléfono.
 */
const TOKEN_DAYS = 30;
const encoder = new TextEncoder();

const keyCache = new Map<string, Promise<CryptoKey>>();

function tokenKey(secret: string): Promise<CryptoKey> {
  let key = keyCache.get(secret);
  if (!key) {
    key = (async () => {
      const base = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      );
      const derived = await crypto.subtle.sign('HMAC', base, encoder.encode('servigo:booking-token:v1'));
      return crypto.subtle.importKey('raw', derived, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
    })();
    keyCache.set(secret, key);
  }
  return key;
}

const b64url = (bytes: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

function fromB64url(value: string): Uint8Array<ArrayBuffer> | null {
  try {
    const bin = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export interface TokenSubject {
  companyId: string;
  code: string;
  phone: string;
}

const message = (s: TokenSubject, exp: number) => encoder.encode(`${s.companyId}:${s.code}:${s.phone}:${exp}`);

export async function signBookingToken(secret: string, subject: TokenSubject, now = Date.now()): Promise<string> {
  const exp = Math.floor(now / 1000) + TOKEN_DAYS * 86_400;
  const sig = await crypto.subtle.sign('HMAC', await tokenKey(secret), message(subject, exp));
  return `${exp}.${b64url(sig)}`;
}

/** Comparación en tiempo constante (la hace `subtle.verify`). */
export async function verifyBookingToken(
  secret: string,
  subject: TokenSubject,
  token: string | null | undefined,
  now = Date.now(),
): Promise<boolean> {
  const match = /^(\d{1,12})\.([A-Za-z0-9_-]{20,})$/.exec(token ?? '');
  if (!match) return false;
  const exp = Number(match[1]);
  if (exp * 1000 < now) return false;
  const sig = fromB64url(match[2]!);
  if (!sig) return false;
  return crypto.subtle.verify('HMAC', await tokenKey(secret), sig, message(subject, exp));
}
