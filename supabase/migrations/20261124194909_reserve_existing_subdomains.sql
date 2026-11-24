-- Fase 04: subdominios que ya existen en la zona roquintech.com y no pasan por el Worker de Servigo.
-- Un registro DNS explícito (o un Custom Domain de Worker) gana sobre el comodín `*`, así que una
-- empresa con ese slug quedaría inaccesible. Ver docs/runbook.md § "Zona DNS compartida".
insert into public.reserved_slugs (slug, reason) values
  -- Microsoft 365 (correo y registro de dispositivos de Roquintech).
  ('enterpriseenrollment', 'system'),
  ('enterpriseregistration', 'system'),
  ('lyncdiscover', 'system'),
  ('sip', 'system'),
  ('msoid', 'system'),
  -- Otros sitios de Roquintech publicados como Custom Domain de Worker.
  ('monicarobles', 'roquintech_product')
on conflict (slug) do nothing;
