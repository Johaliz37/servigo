import type { Modifier } from '@dnd-kit/core';

/** Solo arrastre vertical (equivale a `@dnd-kit/modifiers`, sin otra dependencia). */
export const restrictToVerticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0 });
