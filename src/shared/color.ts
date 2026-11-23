/**
 * Colores de marca → variables CSS de shadcn (fase 03 §2). TS puro.
 * Conversión sRGB → OKLab → OKLCH según https://bottosson.github.io/posts/oklab/.
 */

export interface Oklch {
  l: number; // 0–1
  c: number; // 0–~0.4
  h: number; // 0–360
}

export function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m?.[1]) return null;
  const n = Number.parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toLinear = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

export function hexToOklch(hex: string): Oklch | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map(toLinear) as [number, number, number];

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;

  const c = Math.sqrt(A * A + B * B);
  let h = (Math.atan2(B, A) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: L, c: c < 1e-4 ? 0 : c, h: c < 1e-4 ? 0 : h };
}

export function formatOklch({ l, c, h }: Oklch): string {
  const r = (v: number, d: number) => Number(v.toFixed(d));
  return `oklch(${r(l, 4)} ${r(c, 4)} ${r(h, 2)})`;
}

/** Luminancia relativa WCAG 2.x. */
export function relativeLuminance(hex: string): number | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map(toLinear) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number | null {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la === null || lb === null) return null;
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export const WHITE = '#ffffff';
export const NEAR_BLACK = '#0a0a0a';

/** Texto sobre `bg`: blanco o casi negro, el de mayor contraste (siempre ≥ 4.5 si es posible). */
export function readableForeground(bg: string): string {
  const w = contrastRatio(bg, WHITE) ?? 0;
  const k = contrastRatio(bg, NEAR_BLACK) ?? 0;
  return w >= k ? WHITE : NEAR_BLACK;
}

/**
 * Variables CSS de shadcn para una marca. Devuelve `{}` si los colores no son válidos
 * (se queda el tema neutro por defecto).
 */
export function brandCssVariables(primary: string | null, secondary: string | null): Record<string, string> {
  const vars: Record<string, string> = {};
  const p = primary ? hexToOklch(primary) : null;
  if (primary && p) {
    const pv = formatOklch(p);
    const fg = formatOklch(hexToOklch(readableForeground(primary)) ?? p);
    Object.assign(vars, {
      '--primary': pv,
      '--primary-foreground': fg,
      '--ring': pv,
      '--sidebar-primary': pv,
      '--sidebar-primary-foreground': fg,
      '--sidebar-ring': pv,
      // Tinte suave del primario para hovers/estados (accent de shadcn).
      '--accent': formatOklch({ l: 0.96, c: Math.min(p.c, 0.03), h: p.h }),
      '--accent-foreground': formatOklch({ l: 0.25, c: Math.min(p.c, 0.08), h: p.h }),
    });
  }
  const s = secondary ? hexToOklch(secondary) : null;
  if (secondary && s) {
    Object.assign(vars, {
      '--secondary': formatOklch(s),
      '--secondary-foreground': formatOklch(hexToOklch(readableForeground(secondary)) ?? s),
    });
  }
  return vars;
}
