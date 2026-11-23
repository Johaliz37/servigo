-- Datos de ejemplo SOLO para desarrollo local (`pnpm db:reset`). Nunca se ejecuta en producción.
-- Usuarios (contraseña de todos: Servigo123!):
--   superadmin@servigo.local  → platform_admin
--   owner@demo.local / admin@demo.local / staff@demo.local (staff solo sede Centro)
--   owner@spa.local
-- Reserva con código fijo para pruebas: K7M29QXA (empresa demo).

-- ---------------------------------------------------------------------------
-- Usuarios
-- ---------------------------------------------------------------------------

with u (id, email, name) as (
  values
    ('00000000-0000-4000-a000-000000000001'::uuid, 'superadmin@servigo.local', 'Superadmin Servigo'),
    ('00000000-0000-4000-a000-000000000011'::uuid, 'owner@demo.local', 'Olga Dueña'),
    ('00000000-0000-4000-a000-000000000012'::uuid, 'admin@demo.local', 'Andrés Admin'),
    ('00000000-0000-4000-a000-000000000013'::uuid, 'staff@demo.local', 'Sara Staff'),
    ('00000000-0000-4000-a000-000000000021'::uuid, 'owner@spa.local', 'Lucía Spa')
),
ins as (
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  )
  select
    '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
    extensions.crypt('Servigo123!', extensions.gen_salt('bf')), now(),
    '{"provider": "email", "providers": ["email"]}', jsonb_build_object('name', u.name), now(), now(),
    '', '', '', ''
  from u
  returning id, email
)
insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), ins.id, ins.id::text,
  jsonb_build_object('sub', ins.id::text, 'email', ins.email, 'email_verified', true), 'email', now(), now(), now()
from ins;

insert into public.platform_admins (user_id) values ('00000000-0000-4000-a000-000000000001');

-- ---------------------------------------------------------------------------
-- Empresas y sedes
-- ---------------------------------------------------------------------------

insert into public.companies (id, slug, name, primary_color, secondary_color, contact_email, contact_phone, whatsapp, footer, seo)
values
  ('10000000-0000-4000-a000-000000000001', 'demo', 'Barbería Demo', '#1F4E79', '#F2A93B',
   'hola@demo.local', '+573001112233', '+573001112233',
   '{"text": "Barbería Demo · Cortes clásicos y modernos", "show_socials": true, "links": [{"label": "Políticas", "url": "/politicas"}], "address": "Calle 10 # 20-30, Bogotá", "show_powered_by": true}',
   '{"title": "Barbería Demo", "description": "Reserva tu corte en línea"}'),
  ('10000000-0000-4000-a000-000000000002', 'spa', 'Spa Luna', '#6B4E9B', '#E8D5F2',
   'hola@spa.local', '+573004445566', '+573004445566',
   '{"text": "Spa Luna · Relájate", "show_socials": true, "links": [], "address": "Carrera 7 # 80-12, Bogotá", "show_powered_by": true}',
   '{"title": "Spa Luna", "description": "Masajes y faciales"}');

update public.companies set booking_settings = booking_settings || '{"auto_confirm": true, "require_email": true}'
where slug = 'spa';

insert into public.branches (id, company_id, slug, name, address, city, phone, own_availability, sort_order, header)
values
  ('20000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-000000000001', 'centro', 'Sede Centro',
   'Calle 10 # 20-30', 'Bogotá', '+573001112233', false, 1,
   '{"title": "Sede Centro", "subtitle": "Lunes a sábado", "overlay_opacity": 0.4}'),
  ('20000000-0000-4000-a000-000000000002', '10000000-0000-4000-a000-000000000001', 'norte', 'Sede Norte',
   'Calle 127 # 15-40', 'Bogotá', '+573001112244', true, 2,
   '{"title": "Sede Norte", "subtitle": "Martes a sábado", "overlay_opacity": 0.4}'),
  ('20000000-0000-4000-a000-000000000003', '10000000-0000-4000-a000-000000000002', 'principal', 'Spa Luna Chapinero',
   'Carrera 7 # 80-12', 'Bogotá', '+573004445566', false, 1,
   '{"title": "Spa Luna", "subtitle": "Todos los días", "overlay_opacity": 0.3}');

insert into public.company_members (company_id, user_id, role, branch_ids)
values
  ('10000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000011', 'owner', null),
  ('10000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000012', 'admin', null),
  ('10000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000013', 'staff',
   array['20000000-0000-4000-a000-000000000001'::uuid]),
  ('10000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000021', 'owner', null);

-- ---------------------------------------------------------------------------
-- Contenido
-- ---------------------------------------------------------------------------

insert into public.about_sections (company_id, branch_id, title, body, is_visible)
values
  ('10000000-0000-4000-a000-000000000001', null, 'Sobre nosotros',
   'Desde 2015 cuidamos tu estilo con **cortes clásicos y modernos**.', true),
  ('10000000-0000-4000-a000-000000000002', null, 'Spa Luna', 'Un espacio para desconectarte.', true);

insert into public.sponsors (company_id, branch_id, name, url, sort_order)
values
  ('10000000-0000-4000-a000-000000000001', '20000000-0000-4000-a000-000000000001', 'Navajas Pro', 'https://example.com', 1),
  ('10000000-0000-4000-a000-000000000001', '20000000-0000-4000-a000-000000000001', 'Café del Barrio', 'https://example.org', 2);

insert into public.social_links (company_id, branch_id, network, url, sort_order)
values
  ('10000000-0000-4000-a000-000000000001', null, 'instagram', 'https://instagram.com/barberiademo', 1),
  ('10000000-0000-4000-a000-000000000001', null, 'whatsapp', 'https://wa.me/573001112233', 2),
  ('10000000-0000-4000-a000-000000000001', '20000000-0000-4000-a000-000000000002', 'instagram',
   'https://instagram.com/barberiademo.norte', 1),
  ('10000000-0000-4000-a000-000000000002', null, 'instagram', 'https://instagram.com/spaluna', 1);

-- ---------------------------------------------------------------------------
-- Catálogo
-- ---------------------------------------------------------------------------

insert into public.catalog_items (
  id, company_id, kind, name, reference, short_description, price, duration_minutes,
  buffer_after_minutes, capacity, allow_in_booking, is_featured, sort_order
)
values
  -- demo: servicios
  ('30000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-000000000001', 'service', 'Corte de cabello',
   'SRV-CORTE', 'Corte a tijera o máquina', 35000, 30, 0, 1, false, true, 1),
  ('30000000-0000-4000-a000-000000000002', '10000000-0000-4000-a000-000000000001', 'service', 'Arreglo de barba',
   'SRV-BARBA', 'Perfilado y toalla caliente', 20000, 20, 0, 1, false, false, 2),
  ('30000000-0000-4000-a000-000000000003', '10000000-0000-4000-a000-000000000001', 'service', 'Corte + barba',
   'SRV-COMBO', 'El combo completo', 50000, 50, 10, 1, false, true, 3),
  -- demo: productos
  ('30000000-0000-4000-a000-000000000004', '10000000-0000-4000-a000-000000000001', 'product', 'Cera para cabello',
   'PRD-CERA', 'Fijación media, acabado mate', 28000, null, 0, 1, true, false, 10),
  ('30000000-0000-4000-a000-000000000005', '10000000-0000-4000-a000-000000000001', 'product', 'Shampoo anticaspa',
   'PRD-SHAMPOO', '250 ml', 25000, null, 0, 1, true, false, 11),
  -- spa: servicios
  ('30000000-0000-4000-a000-000000000011', '10000000-0000-4000-a000-000000000002', 'service', 'Masaje relajante',
   'SPA-MASAJE', '60 minutos de relajación', 120000, 60, 15, 2, false, true, 1),
  ('30000000-0000-4000-a000-000000000012', '10000000-0000-4000-a000-000000000002', 'service', 'Limpieza facial',
   'SPA-FACIAL', 'Limpieza profunda', 90000, 45, 15, 1, false, false, 2),
  -- spa: producto
  ('30000000-0000-4000-a000-000000000013', '10000000-0000-4000-a000-000000000002', 'product', 'Aceite esencial',
   'SPA-ACEITE', 'Lavanda, 30 ml', 40000, null, 0, 1, true, false, 10);

update public.catalog_items set stock = 30 where id = '30000000-0000-4000-a000-000000000004';

insert into public.catalog_item_details (company_id, item_id, label, value, sort_order)
values
  ('10000000-0000-4000-a000-000000000001', '30000000-0000-4000-a000-000000000001', 'Incluye', 'Lavado y peinado', 1),
  ('10000000-0000-4000-a000-000000000001', '30000000-0000-4000-a000-000000000001', 'Duración', '30 minutos', 2),
  ('10000000-0000-4000-a000-000000000002', '30000000-0000-4000-a000-000000000011', 'Incluye', 'Aromaterapia', 1);

insert into public.service_products (company_id, service_id, product_id, max_quantity, sort_order)
values
  ('10000000-0000-4000-a000-000000000001', '30000000-0000-4000-a000-000000000001', '30000000-0000-4000-a000-000000000004', 3, 1),
  ('10000000-0000-4000-a000-000000000001', '30000000-0000-4000-a000-000000000001', '30000000-0000-4000-a000-000000000005', 2, 2),
  ('10000000-0000-4000-a000-000000000001', '30000000-0000-4000-a000-000000000003', '30000000-0000-4000-a000-000000000004', 3, 1),
  ('10000000-0000-4000-a000-000000000002', '30000000-0000-4000-a000-000000000011', '30000000-0000-4000-a000-000000000013', 2, 1);

insert into public.discounts (company_id, item_id, label, type, value, starts_at, ends_at)
values
  ('10000000-0000-4000-a000-000000000002', '30000000-0000-4000-a000-000000000011', 'Promo de temporada', 'percent', 15,
   now() - interval '1 day', now() + interval '30 days'),
  ('10000000-0000-4000-a000-000000000001', '30000000-0000-4000-a000-000000000003', 'Combo vencido', 'fixed', 5000,
   now() - interval '60 days', now() - interval '30 days');

-- ---------------------------------------------------------------------------
-- Información adicional
-- ---------------------------------------------------------------------------

insert into public.booking_fields (company_id, service_id, label, type, options, required, sort_order)
values
  ('10000000-0000-4000-a000-000000000001', null, '¿Cómo nos conociste?', 'select',
   '[{"value": "instagram", "label": "Instagram"}, {"value": "amigo", "label": "Un amigo"}, {"value": "otro", "label": "Otro"}]',
   false, 1),
  ('10000000-0000-4000-a000-000000000002', null, 'Comentarios para tu terapeuta', 'textarea', '[]', false, 1),
  ('10000000-0000-4000-a000-000000000002', null, 'Acepto las políticas de cancelación', 'checkbox', '[]', true, 2),
  ('10000000-0000-4000-a000-000000000002', '30000000-0000-4000-a000-000000000011', 'Presión', 'radio',
   '[{"value": "suave", "label": "Suave"}, {"value": "media", "label": "Media"}, {"value": "fuerte", "label": "Fuerte"}]',
   true, 3),
  ('10000000-0000-4000-a000-000000000002', '30000000-0000-4000-a000-000000000011', 'Zonas', 'multiselect',
   '[{"value": "espalda", "label": "Espalda"}, {"value": "cuello", "label": "Cuello"}, {"value": "piernas", "label": "Piernas"}]',
   false, 4);

-- ---------------------------------------------------------------------------
-- Disponibilidad (horas locales de Bogotá)
-- ---------------------------------------------------------------------------

insert into public.availability_events (company_id, branch_id, kind, title, starts_at, ends_at, timezone, rrule, all_day)
values
  -- demo, nivel empresa (lo usa Centro): L–S 9:00–19:00, almuerzo L–V 13:00–14:00
  ('10000000-0000-4000-a000-000000000001', null, 'open', 'Horario general',
   timestamp '2026-01-05 09:00' at time zone 'America/Bogota', timestamp '2026-01-05 19:00' at time zone 'America/Bogota',
   'America/Bogota', 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA', false),
  ('10000000-0000-4000-a000-000000000001', null, 'closed', 'Almuerzo',
   timestamp '2026-01-05 13:00' at time zone 'America/Bogota', timestamp '2026-01-05 14:00' at time zone 'America/Bogota',
   'America/Bogota', 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', false),
  ('10000000-0000-4000-a000-000000000001', null, 'closed', 'Navidad',
   timestamp '2026-12-25 00:00' at time zone 'America/Bogota', timestamp '2026-12-26 00:00' at time zone 'America/Bogota',
   'America/Bogota', null, true),
  -- demo, Sede Norte (disponibilidad propia): M–S 10:00–18:00
  ('10000000-0000-4000-a000-000000000001', '20000000-0000-4000-a000-000000000002', 'open', 'Horario Norte',
   timestamp '2026-01-06 10:00' at time zone 'America/Bogota', timestamp '2026-01-06 18:00' at time zone 'America/Bogota',
   'America/Bogota', 'FREQ=WEEKLY;BYDAY=TU,WE,TH,FR,SA', false),
  -- spa: todos los días 8:00–20:00
  ('10000000-0000-4000-a000-000000000002', null, 'open', 'Horario Spa',
   timestamp '2026-01-05 08:00' at time zone 'America/Bogota', timestamp '2026-01-05 20:00' at time zone 'America/Bogota',
   'America/Bogota', 'FREQ=DAILY', false);

-- ---------------------------------------------------------------------------
-- Clientes y 20 reservas (14 demo + 6 spa), de hace 10 días a dentro de 10
-- ---------------------------------------------------------------------------

insert into public.customers (id, company_id, name, phone, email)
select
  ('40000000-0000-4000-a000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  case when n <= 8 then '10000000-0000-4000-a000-000000000001'::uuid else '10000000-0000-4000-a000-000000000002'::uuid end,
  (array['Carlos Pérez', 'Juan Gómez', 'Andrés Ruiz', 'Felipe Díaz', 'Mateo López', 'Santiago Mora', 'Diego Castro',
         'Tomás Vargas', 'Laura Ríos', 'Camila Torres', 'Valentina Rojas', 'Mariana Silva'])[n],
  '+57300' || lpad((2000000 + n)::text, 7, '0'),
  case when n % 2 = 0 or n > 8 then 'cliente' || n || '@example.com' end
from generate_series(1, 12) as n;

with plan as (
  select
    n,
    n <= 14 as is_demo,
    -- día relativo, saltando domingos
    current_date + (n - 10) as raw_day,
    (array[9, 10, 11, 14, 15, 16, 17])[1 + (n % 7)] as hour
  from generate_series(1, 20) as n
),
slots as (
  select
    p.*,
    case when extract(isodow from p.raw_day) = 7 then p.raw_day + 1 else p.raw_day end as day
  from plan p
),
rows as (
  select
    s.n,
    case when s.is_demo then '10000000-0000-4000-a000-000000000001'::uuid
         else '10000000-0000-4000-a000-000000000002'::uuid end as company_id,
    case when not s.is_demo then '20000000-0000-4000-a000-000000000003'::uuid
         when s.n % 2 = 0 then '20000000-0000-4000-a000-000000000002'::uuid
         else '20000000-0000-4000-a000-000000000001'::uuid end as branch_id,
    case when s.is_demo then (array['30000000-0000-4000-a000-000000000001', '30000000-0000-4000-a000-000000000002',
                                     '30000000-0000-4000-a000-000000000003'])[1 + s.n % 3]::uuid
         else (array['30000000-0000-4000-a000-000000000011', '30000000-0000-4000-a000-000000000012'])[1 + s.n % 2]::uuid
    end as service_id,
    case when s.is_demo then ('40000000-0000-4000-a000-0000000000' || lpad((1 + s.n % 8)::text, 2, '0'))::uuid
         else ('40000000-0000-4000-a000-0000000000' || lpad((9 + s.n % 4)::text, 2, '0'))::uuid end as customer_id,
    (s.day + make_time(s.hour, 0, 0)) at time zone 'America/Bogota' as starts_at,
    s.day < current_date as is_past
  from slots s
)
insert into public.bookings (
  company_id, branch_id, service_id, customer_id, code, status, starts_at, ends_at, block_starts_at, block_ends_at,
  customer_name, customer_phone, customer_email, service_name, service_price, service_discount, total, currency,
  source, cancelled_at, cancel_reason
)
select
  r.company_id, r.branch_id, r.service_id, r.customer_id,
  case when r.n = 1 then 'K7M29QXA' else public.generate_booking_code() end,
  st.status,
  r.starts_at,
  r.starts_at + make_interval(mins => i.duration_minutes),
  r.starts_at - make_interval(mins => i.buffer_before_minutes),
  r.starts_at + make_interval(mins => i.duration_minutes + i.buffer_after_minutes),
  c.name, c.phone, c.email, i.name, i.price, 0, i.price, co.currency,
  case when r.n % 5 = 0 then 'admin' else 'web' end,
  case when st.status = 'cancelled' then r.starts_at - interval '1 day' end,
  case when st.status = 'cancelled' then 'El cliente no puede asistir' end
from rows r
join public.catalog_items i on i.id = r.service_id
join public.customers c on c.id = r.customer_id
join public.companies co on co.id = r.company_id
cross join lateral (
  select (case
    when r.is_past then (array['completed', 'completed', 'no_show', 'cancelled'])[1 + r.n % 4]
    else (array['pending', 'confirmed', 'confirmed'])[1 + r.n % 3]
  end)::public.booking_status as status
) st;

-- Un producto añadido y una respuesta en la reserva K7M29QXA.
insert into public.booking_items (company_id, booking_id, product_id, name, unit_price, quantity, line_total)
select b.company_id, b.id, '30000000-0000-4000-a000-000000000004', 'Cera para cabello', 28000, 1, 28000
from public.bookings b where b.code = 'K7M29QXA';

update public.bookings set products_total = 28000, total = total + 28000 where code = 'K7M29QXA';

insert into public.booking_answers (company_id, booking_id, field_id, label, type, value)
select b.company_id, b.id, f.id, f.label, f.type, '"instagram"'
from public.bookings b
join public.booking_fields f on f.company_id = b.company_id and f.label = '¿Cómo nos conociste?'
where b.code = 'K7M29QXA';

insert into public.booking_events (company_id, booking_id, action, payload)
select company_id, id, 'created', jsonb_build_object('source', source) from public.bookings;
