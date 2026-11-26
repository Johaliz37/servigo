/**
 * Fase 13 (D31): política de privacidad por empresa y autorización de datos en la reserva.
 * La plantilla sigue la Ley 1581 de 2012 y el Decreto 1074 de 2015 (Colombia). Es orientativa:
 * cada empresa debe revisarla con su asesor y puede reemplazarla por un texto propio.
 */

export const PRIVACY_PATH = '/privacidad';
export const MAX_PRIVACY_LENGTH = 20_000;

/** Marcador del teléfono de un cliente anonimizado (`anonymize_customer`). */
export const isAnonymizedPhone = (phone: string | null | undefined) => !!phone && phone.startsWith('anon-');

export interface PrivacyCompany {
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
}

/** Texto de la casilla obligatoria del paso de datos. */
export const consentLabel = (companyName: string) =>
  `Autorizo a ${companyName} a tratar mis datos personales para gestionar mi reserva, según su política de privacidad.`;

/** Plantilla en Markdown con los datos de la empresa. */
export function privacyTemplate(c: PrivacyCompany): string {
  const contact = [
    c.email && `correo ${c.email}`,
    c.phone && `teléfono ${c.phone}`,
    c.address && `dirección ${c.address}`,
  ].filter(Boolean);
  const channels = contact.length ? contact.join(', ') : 'los datos de contacto publicados en este sitio';
  return `## Responsable del tratamiento

**${c.name}**, contacto: ${channels}.

## Datos que recogemos

Cuando reservas en línea pedimos tu nombre, teléfono, correo (opcional u obligatorio según el servicio), tus notas y las respuestas a la información adicional del servicio. También guardamos el historial de tus reservas.

## Para qué los usamos

- Agendar, confirmar, reprogramar o cancelar tus reservas.
- Contactarte por teléfono, WhatsApp o correo sobre tus reservas.
- Llevar estadísticas internas del negocio, sin publicarlas.

No vendemos ni cedemos tus datos a terceros para publicidad.

## Tus derechos

Como titular de los datos (artículo 8 de la Ley 1581 de 2012) puedes:

- Conocer, actualizar y rectificar tus datos.
- Pedir prueba de la autorización que nos diste.
- Saber qué uso les hemos dado.
- Revocar la autorización o pedir que eliminemos tus datos, si no hay un deber legal o contractual de conservarlos.
- Presentar quejas ante la Superintendencia de Industria y Comercio.
- Acceder a tus datos gratuitamente.

## Cómo ejercerlos

Escríbenos por ${channels} indicando tu nombre y el teléfono con el que reservaste. Respondemos las consultas en un máximo de 10 días hábiles y los reclamos en un máximo de 15 días hábiles, como fija la ley.

## Quién más trata los datos

La plataforma de reservas Servigo (Roquintech) aloja la información como encargada del tratamiento, con proveedores de infraestructura que pueden estar fuera de Colombia y que aplican medidas de seguridad equivalentes.

## Vigencia

Conservamos tus datos mientras tengas reservas con nosotros o hasta que pidas su eliminación. Esta política rige desde su publicación y te avisaremos aquí de cualquier cambio.`;
}
