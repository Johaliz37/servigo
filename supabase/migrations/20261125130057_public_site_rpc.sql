-- Fase 09: RPC del sitio público (00 §3, regla 1). Devuelven JSON listo para pintar, solo de
-- empresas y sedes activas, sin ítems inactivos ni contenido oculto. Los precios salen de
-- effective_catalog / effective_addons (D24), así coinciden con el panel y con la reserva.
-- security definer + grant a anon: el rol anon sigue sin tocar tablas.

-- ---------------------------------------------------------------------------
-- Helpers internos (sin grant: solo los usan las RPC de abajo, que corren como su dueño).
-- ---------------------------------------------------------------------------

-- Empresa activa por slug (citext: sin distinguir mayúsculas). null si no existe o está suspendida.
create function public.public_company(p_slug text)
returns public.companies
language sql
stable
security definer
set search_path = ''
as $$
  select c.*
  from public.companies c
  where c.slug operator(extensions.=) btrim(p_slug)::extensions.citext
    and c.status = 'active';
$$;

-- Sede activa de la empresa por slug.
create function public.public_branch(p_company uuid, p_branch_slug text)
returns public.branches
language sql
stable
security definer
set search_path = ''
as $$
  select b.*
  from public.branches b
  where b.company_id = p_company
    and b.slug operator(extensions.=) btrim(p_branch_slug)::extensions.citext
    and b.is_active;
$$;

-- Ítems que la sede ofrece hoy, con el precio de effective_catalog, en la forma pública.
create function public.public_catalog(p_branch uuid)
returns table (item_id uuid, kind public.catalog_kind, sort_order int, name text, description text, item jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select
    e.item_id,
    e.kind,
    e.sort_order,
    e.name,
    e.description,
    jsonb_build_object(
      'id', e.item_id,
      'kind', e.kind,
      'name', e.name,
      'short_description', e.short_description,
      'duration_minutes', e.duration_minutes,
      'is_featured', e.is_featured,
      'cover', case when e.cover_path is null then null
                    else jsonb_build_object('path', e.cover_path, 'alt', e.cover_alt) end,
      'price', e.base_price,
      'final_price', e.final_price,
      'discount', case when e.discount_id is null then null
                       else jsonb_build_object(
                         'label', e.discount_label, 'type', e.discount_type, 'value', e.discount_value,
                         'amount', e.discount_amount, 'ends_at', e.discount_ends_at) end
    )
  from public.effective_catalog(p_branch, now()) e;
$$;

-- Redes visibles de la sede si tiene alguna propia (visible o no, como en el panel); si no,
-- las visibles de la empresa.
create function public.public_socials(p_company uuid, p_branch uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object('network', s.network, 'label', s.label, 'url', s.url)
    order by s.sort_order, s.created_at
  ), '[]'::jsonb)
  from public.social_links s
  where s.company_id = p_company
    and s.is_visible
    and s.branch_id is not distinct from (
      case when p_branch is not null
                and exists (select 1 from public.social_links o where o.branch_id = p_branch)
           then p_branch end
    );
$$;

-- ¿Hay alguna sección de «Acerca de» visible (general o de una sede activa)?
create function public.public_about_visible(p_company uuid, p_branch uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.about_sections a
    left join public.branches b on b.id = a.branch_id
    where a.company_id = p_company
      and a.is_visible
      and (a.branch_id is null or b.is_active)
      and (p_branch is null or a.branch_id = p_branch)
  );
$$;

-- ---------------------------------------------------------------------------
-- get_public_site(slug): marca, footer, contacto, sedes activas y redes de la empresa.
-- ---------------------------------------------------------------------------
create function public.get_public_site(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'company', jsonb_build_object(
      'name', c.name,
      'logo_path', c.logo_path,
      'hero_image_path', c.hero_image_path,
      'primary_color', c.primary_color,
      'secondary_color', c.secondary_color,
      'footer', c.footer,
      'seo', c.seo,
      'contact', jsonb_build_object('email', c.contact_email, 'phone', c.contact_phone, 'whatsapp', c.whatsapp)
    ),
    'branches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'slug', b.slug, 'name', b.name, 'city', b.city, 'cover_image_path', b.cover_image_path,
        'sort_order', b.sort_order
      ) order by b.sort_order, b.name)
      from public.branches b
      where b.company_id = c.id and b.is_active
    ), '[]'::jsonb),
    'socials_company', public.public_socials(c.id, null),
    'about_visible', public.public_about_visible(c.id)
  )
  from public.public_company(p_slug) c
  where c.id is not null;
$$;

-- ---------------------------------------------------------------------------
-- get_public_branch(slug, sede): encabezado, servicios, productos, patrocinadores y redes.
-- ---------------------------------------------------------------------------
create function public.get_public_branch(p_slug text, p_branch_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'branch', jsonb_build_object(
      'id', b.id,
      'slug', b.slug,
      'name', b.name,
      'city', b.city,
      'header', b.header,
      'cover_image_path', b.cover_image_path,
      'address', b.address,
      'phone', b.phone,
      'whatsapp', b.whatsapp,
      'maps_url', b.maps_url,
      'timezone', coalesce(b.timezone, c.timezone)
    ),
    'services', coalesce((
      select jsonb_agg(pc.item order by pc.sort_order, pc.name)
      from public.public_catalog(b.id) pc where pc.kind = 'service'
    ), '[]'::jsonb),
    'products', coalesce((
      select jsonb_agg(pc.item order by pc.sort_order, pc.name)
      from public.public_catalog(b.id) pc where pc.kind = 'product'
    ), '[]'::jsonb),
    'sponsors', case when b.show_sponsors then coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', s.name, 'description', s.description, 'image_path', s.image_path, 'url', s.url
      ) order by s.sort_order, s.created_at)
      from public.sponsors s
      where s.branch_id = b.id and s.is_visible
    ), '[]'::jsonb) else '[]'::jsonb end,
    'socials', public.public_socials(c.id, b.id),
    'about_branch_visible', public.public_about_visible(c.id, b.id)
  )
  from public.public_company(p_slug) c
  join lateral public.public_branch(c.id, p_branch_slug) b on b.id is not null
  where c.id is not null;
$$;

-- ---------------------------------------------------------------------------
-- get_public_item(slug, sede, ítem): ficha completa y, si es un servicio, sus productos
-- complementarios que se pueden añadir al reservar (effective_addons).
-- ---------------------------------------------------------------------------
create function public.get_public_item(p_slug text, p_branch_slug text, p_item_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pc.item || jsonb_build_object(
    'description', pc.description,
    'branch', jsonb_build_object('id', b.id, 'slug', b.slug, 'name', b.name),
    'photos', coalesce((
      select jsonb_agg(jsonb_build_object('path', ph.path, 'thumb_path', ph.thumb_path, 'alt', ph.alt)
                       order by ph.is_cover desc, ph.sort_order, ph.created_at)
      from public.catalog_item_photos ph
      where ph.item_id = pc.item_id
    ), '[]'::jsonb),
    'details', coalesce((
      select jsonb_agg(jsonb_build_object('label', d.label, 'value', d.value) order by d.sort_order, d.created_at)
      from public.catalog_item_details d
      where d.item_id = pc.item_id
    ), '[]'::jsonb),
    'addons', case when pc.kind = 'service' then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.item_id,
        'kind', 'product',
        'name', a.name,
        'short_description', a.short_description,
        'cover', case when a.cover_path is null then null
                      else jsonb_build_object('path', a.cover_path, 'alt', a.cover_alt) end,
        'price', a.base_price,
        'final_price', a.final_price,
        'discount', case when a.discount_id is null then null
                         else jsonb_build_object(
                           'label', a.discount_label, 'type', a.discount_type, 'value', a.discount_value,
                           'amount', a.discount_amount, 'ends_at', a.discount_ends_at) end,
        'max_quantity', a.max_quantity
      ))
      from public.effective_addons(pc.item_id, b.id, now()) a
    ), '[]'::jsonb) else '[]'::jsonb end
  )
  from public.public_company(p_slug) c
  join lateral public.public_branch(c.id, p_branch_slug) b on b.id is not null
  join lateral public.public_catalog(b.id) pc on pc.item_id = p_item_id
  where c.id is not null;
$$;

-- ---------------------------------------------------------------------------
-- get_public_about(slug, sede?): secciones visibles (la general primero y luego las de las
-- sedes activas). Con sede, solo la general y la de esa sede.
-- ---------------------------------------------------------------------------
create function public.get_public_about(p_slug text, p_branch_slug text default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'branch_slug', b.slug, 'branch_name', b.name,
      'title', a.title, 'body', a.body, 'image_path', a.image_path
    ) order by (a.branch_id is not null), b.sort_order, b.name)
    from public.about_sections a
    left join public.branches b on b.id = a.branch_id
    where a.company_id = c.id
      and a.is_visible
      and (a.branch_id is null or b.is_active)
      and (p_branch_slug is null or a.branch_id is null
           or b.slug operator(extensions.=) btrim(p_branch_slug)::extensions.citext)
  ), '[]'::jsonb)
  from public.public_company(p_slug) c
  where c.id is not null;
$$;

-- ---------------------------------------------------------------------------
-- get_public_sitemap(slug): rutas públicas indexables (sitemap.xml del Worker).
-- ---------------------------------------------------------------------------
create function public.get_public_sitemap(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'about_visible', public.public_about_visible(c.id),
    'branches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'slug', b.slug,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object('id', pc.item_id, 'kind', pc.kind) order by pc.kind, pc.sort_order, pc.name)
          from public.public_catalog(b.id) pc
        ), '[]'::jsonb)
      ) order by b.sort_order, b.name)
      from public.branches b
      where b.company_id = c.id and b.is_active
    ), '[]'::jsonb)
  )
  from public.public_company(p_slug) c
  where c.id is not null;
$$;

revoke execute on function
  public.public_company(text),
  public.public_branch(uuid, text),
  public.public_catalog(uuid),
  public.public_socials(uuid, uuid),
  public.public_about_visible(uuid, uuid)
from public, anon, authenticated;

grant execute on function
  public.get_public_site(text),
  public.get_public_branch(text, text),
  public.get_public_item(text, text, uuid),
  public.get_public_about(text, text),
  public.get_public_sitemap(text)
to anon, authenticated, service_role;
