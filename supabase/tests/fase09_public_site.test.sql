-- Fase 09: RPC del sitio público. Nunca devuelven sedes o ítems inactivos ni contenido oculto,
-- los precios son los de effective_catalog y una empresa no ve datos de otra.
-- create_tenant deja: b1 y b2 activas, servicio (100, -10 %) con foto y detalle, producto
-- (10, allow_in_booking) asociado al servicio, patrocinador visible en b1, red de la empresa
-- visible y la sección «Acerca de» general oculta.
begin;
select plan(30);

create temp table fx on commit drop as select tests.create_tenant('pub-co') as a;
alter table fx add column other jsonb;
update fx set other = tests.create_tenant('pub-otra');
grant select on fx to anon;

create function pg_temp.fx(p_key text) returns uuid language sql as $$ select (a ->> p_key)::uuid from fx $$;
create function pg_temp.other(p_key text) returns uuid language sql as $$ select (other ->> p_key)::uuid from fx $$;
grant execute on function pg_temp.fx(text), pg_temp.other(text) to anon;

-- Sitio ------------------------------------------------------------------------
select tests.authenticate_as_anon();

select is(public.get_public_site('PUB-CO') -> 'company' ->> 'name', 'Empresa pub-co',
  'anon lee el sitio (el slug no distingue mayúsculas)');
select is(jsonb_array_length(public.get_public_site('pub-co') -> 'branches'), 2, 'las dos sedes activas');
select is(public.get_public_site('pub-co') ->> 'about_visible', 'false', '«Acerca de» oculto: sin enlace');
select is(jsonb_array_length(public.get_public_site('pub-co') -> 'socials_company'), 1, 'redes de la empresa');
select ok(not (public.get_public_site('pub-co') -> 'company' ?| array['tax_id', 'legal_name', 'booking_settings']),
  'el sitio no expone datos internos de la empresa');
select is(public.get_public_site('no-existe'), null, 'empresa inexistente → null');

-- Sede -------------------------------------------------------------------------
select is(jsonb_array_length(public.get_public_branch('pub-co', 'sede-1') -> 'services'), 1, 'un servicio');
select is(jsonb_array_length(public.get_public_branch('pub-co', 'sede-1') -> 'products'), 1, 'un producto');
select is(public.get_public_branch('pub-co', 'sede-1') -> 'services' -> 0 ->> 'final_price', '90',
  'el servicio sale con su descuento vigente');
select is(jsonb_array_length(public.get_public_branch('pub-co', 'sede-1') -> 'sponsors'), 1, 'patrocinador visible');
select is(jsonb_array_length(public.get_public_branch('pub-co', 'sede-2') -> 'socials'), 1,
  'una sede sin redes propias hereda las de la empresa');
select is(public.get_public_branch('pub-co', 'nada'), null, 'sede inexistente → null');
select is(public.get_public_branch('pub-otra', 'sede-1') -> 'services' -> 0 ->> 'id', pg_temp.other('service')::text,
  'cada empresa ve solo su catálogo');

-- Paridad de precios con effective_catalog (D24) ---------------------------------
select tests.clear_authentication();
select results_eq(
  format($$select (i ->> 'id')::uuid, (i ->> 'price')::numeric, (i ->> 'final_price')::numeric,
                  coalesce((i -> 'discount' ->> 'amount')::numeric, 0)
           from jsonb_array_elements((public.get_public_branch('pub-co', 'sede-1') -> 'services')
                                     || (public.get_public_branch('pub-co', 'sede-1') -> 'products')) i
           order by 1$$),
  format($$select item_id, base_price, final_price, discount_amount from public.effective_catalog(%L)
           order by 1$$, pg_temp.fx('b1')),
  'precios iguales a effective_catalog');

-- Ficha ------------------------------------------------------------------------
select tests.authenticate_as_anon();
select is(
  (select jsonb_build_array(jsonb_array_length(i -> 'photos'), jsonb_array_length(i -> 'details'),
                            jsonb_array_length(i -> 'addons'), i -> 'branch' ->> 'slug')
   from (select public.get_public_item('pub-co', 'sede-1', pg_temp.fx('service')) i) x),
  '[1, 1, 1, "sede-1"]'::jsonb,
  'la ficha trae fotos, detalles, complementos y la sede');
select is(public.get_public_item('pub-co', 'sede-1', pg_temp.other('service')), null,
  'la ficha de un ítem de otra empresa → null');
select throws_ok($$select * from public.public_catalog(pg_temp.fx('b1'))$$, '42501', null,
  'anon no ejecuta los helpers internos');

-- Oculto o inactivo nunca aparece -------------------------------------------------
select tests.clear_authentication();
update public.catalog_items set allow_in_booking = false where id = pg_temp.fx('product');
update public.sponsors set is_visible = false where company_id = pg_temp.fx('company');
insert into public.social_links (company_id, branch_id, network, url, is_visible)
values (pg_temp.fx('company'), pg_temp.fx('b2'), 'tiktok', 'https://tiktok.com/@x', false);
update public.about_sections set is_visible = true where company_id = pg_temp.fx('company');
insert into public.about_sections (company_id, branch_id, title, is_visible)
values (pg_temp.fx('company'), pg_temp.fx('b2'), 'Sede 2', true);
update public.branches set is_active = false where id = pg_temp.fx('b2');
select tests.authenticate_as_anon();

select is(jsonb_array_length(public.get_public_item('pub-co', 'sede-1', pg_temp.fx('service')) -> 'addons'), 0,
  'un producto que no se ofrece al reservar no es complemento');
select is(jsonb_array_length(public.get_public_branch('pub-co', 'sede-1') -> 'sponsors'), 0,
  'patrocinador oculto no aparece');
select is(jsonb_array_length(public.get_public_site('pub-co') -> 'branches'), 1, 'sede inactiva fuera del sitio');
select is(public.get_public_branch('pub-co', 'sede-2'), null, 'sede inactiva → null');
select is(public.get_public_site('pub-co') ->> 'about_visible', 'true', 'sección visible: hay enlace');
select is(
  (select jsonb_agg(s ->> 'title') from jsonb_array_elements(public.get_public_about('pub-co')) s),
  '["Acerca"]'::jsonb, 'la sección de una sede inactiva no aparece en «Acerca de»');

select tests.clear_authentication();
update public.branches set is_active = true where id = pg_temp.fx('b2');
update public.catalog_items set is_active = false where id = pg_temp.fx('product');
update public.branches set show_sponsors = false, own_catalog = true where id = pg_temp.fx('b1');
update public.sponsors set is_visible = true where company_id = pg_temp.fx('company');
update public.branch_catalog_items set is_active = false
where branch_id = pg_temp.fx('b1') and item_id = pg_temp.fx('service');
select tests.authenticate_as_anon();

select is(jsonb_array_length(public.get_public_branch('pub-co', 'sede-2') -> 'products'), 0,
  'producto inactivo no aparece');
select is(public.get_public_item('pub-co', 'sede-2', pg_temp.fx('product')), null, 'ficha de producto inactivo → null');
select is(jsonb_array_length(public.get_public_branch('pub-co', 'sede-1') -> 'services'), 0,
  'catálogo propio: lo que la sede no ofrece no aparece');
select is(jsonb_array_length(public.get_public_branch('pub-co', 'sede-1') -> 'sponsors'), 0,
  'la sede apagó los patrocinadores');
select is(jsonb_array_length(public.get_public_branch('pub-co', 'sede-2') -> 'socials'), 0,
  'una sede con redes propias (aunque ocultas) no hereda las de la empresa');
select is(
  (select jsonb_agg(s ->> 'title') from jsonb_array_elements(public.get_public_about('pub-co', 'sede-2')) s),
  '["Acerca", "Sede 2"]'::jsonb, '«Acerca de» de una sede: la general y la suya');

-- Empresa suspendida ---------------------------------------------------------------
select tests.clear_authentication();
update public.companies set status = 'suspended' where id = pg_temp.fx('company');
select tests.authenticate_as_anon();

select ok(public.get_public_site('pub-co') is null and public.get_public_branch('pub-co', 'sede-2') is null
          and public.get_public_sitemap('pub-co') is null,
  'empresa suspendida: sin sitio, sedes ni sitemap');

select tests.clear_authentication();
select * from finish();
rollback;
