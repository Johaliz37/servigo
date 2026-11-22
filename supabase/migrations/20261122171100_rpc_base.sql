-- RPC base (02 §6). Las de sitio público y reservas se crean en las fases 09–10.

-- Keep-alive del proyecto Supabase Free (00 §8).
create function public.ping()
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select now();
$$;

-- Datos mínimos para que el Worker resuelva el tenant y pinte la marca.
-- Devuelve null si no existe. Las empresas suspendidas se devuelven con su estado
-- para que el Worker muestre "Sitio temporalmente no disponible".
create function public.get_company_by_slug(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id,
    'slug', c.slug,
    'name', c.name,
    'status', c.status,
    'timezone', c.timezone,
    'currency', c.currency,
    'locale', c.locale,
    'branding', jsonb_build_object(
      'logo_path', c.logo_path,
      'favicon_path', c.favicon_path,
      'primary_color', c.primary_color,
      'secondary_color', c.secondary_color
    ),
    'seo', c.seo
  )
  from public.companies c
  -- Con search_path = '' hay que calificar el operador de citext; un `=` a secas
  -- compara como text y distingue mayúsculas.
  where c.slug operator(extensions.=) btrim(p_slug)::extensions.citext;
$$;

grant execute on function public.ping() to anon, authenticated, service_role;
grant execute on function public.get_company_by_slug(text) to anon, authenticated, service_role;
