/**
 * Dominio raíz visto desde la plataforma: la consola vive en `servigo.<raíz>`
 * (en local, en el host raíz `localhost`).
 */
export const ROOT_DOMAIN =
  window.location.hostname === 'localhost' ? 'localhost' : window.location.hostname.split('.').slice(1).join('.');
