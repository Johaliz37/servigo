-- Bucket público `media` (lectura por URL directa, 00 D14) y políticas de escritura por empresa.
-- Ruta: {company_id}/{entidad}/{uuid}-{hash}.webp

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 2 * 1024 * 1024, array['image/webp', 'image/jpeg', 'image/png', 'image/svg+xml'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Convierte a uuid sin lanzar error (una carpeta con nombre arbitrario debe dar "sin permiso", no un 500).
create function public.try_uuid(p_value text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return p_value::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

grant execute on function public.try_uuid(text) to authenticated, service_role;

-- Lectura pública por URL: no requiere política de select. Esta permite a owner/admin
-- listar y sobrescribir (upsert) sus propios archivos.
create policy media_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'media'
    and public.has_company_role(public.try_uuid((storage.foldername(name))[1]), '{owner,admin}')
  );

create policy media_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'media'
    and public.has_company_role(public.try_uuid((storage.foldername(name))[1]), '{owner,admin}')
  );

create policy media_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'media'
    and public.has_company_role(public.try_uuid((storage.foldername(name))[1]), '{owner,admin}')
  )
  with check (
    bucket_id = 'media'
    and public.has_company_role(public.try_uuid((storage.foldername(name))[1]), '{owner,admin}')
  );

create policy media_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'media'
    and public.has_company_role(public.try_uuid((storage.foldername(name))[1]), '{owner,admin}')
  );

-- Uso de almacenamiento de una empresa, en bytes (límite blando: 100 MB).
create function public.company_storage_usage(p_company uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_company_role(p_company) then
    raise exception 'Sin acceso a la empresa' using errcode = '42501';
  end if;
  return (
    select coalesce(sum((o.metadata ->> 'size')::bigint), 0)
    from storage.objects o
    where o.bucket_id = 'media' and o.name like p_company::text || '/%'
  );
end;
$$;

grant execute on function public.company_storage_usage(uuid) to authenticated, service_role;
