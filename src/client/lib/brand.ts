import { brandCssVariables } from '@shared/color';

let applied: string[] = [];

/**
 * Aplica la marca de la empresa como variables CSS de shadcn en `<html>`.
 * Los estilos en línea ganan a `:root` y a `.dark`, así la marca vale en ambos modos.
 */
export function applyBrand(primary: string | null, secondary: string | null): void {
  const root = document.documentElement;
  for (const name of applied) root.style.removeProperty(name);
  const vars = brandCssVariables(primary, secondary);
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
  applied = Object.keys(vars);
}
