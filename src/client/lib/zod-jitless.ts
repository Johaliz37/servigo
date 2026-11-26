/**
 * Zod 4 prueba `new Function` para compilar validadores; con la CSP sin `unsafe-eval` (fase 13)
 * esa prueba dispara una violación aunque Zod la capture. Se importa antes que nada en
 * `main.tsx` para que el config global exista cuando Zod se evalúe (sin importar Zod aquí).
 */
const g = globalThis as { __zod_globalConfig?: { jitless?: boolean } };
g.__zod_globalConfig = { ...g.__zod_globalConfig, jitless: true };
export {};
