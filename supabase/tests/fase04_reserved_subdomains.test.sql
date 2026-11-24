begin;
select plan(3);

-- Los subdominios ya ocupados en la zona DNS no se pueden asignar a una empresa (fase 04).
select is(
  (select count(*)::int from public.reserved_slugs
    where slug in ('monicarobles', 'enterpriseenrollment', 'enterpriseregistration', 'autodiscover')),
  4,
  'subdominios de la zona compartida reservados'
);

select is(public.slug_status('monicarobles'), 'reserved', 'monicarobles: reservado');

select throws_ok(
  $$insert into public.companies (name, slug) values ('Choque DNS', 'enterpriseenrollment')$$,
  '23514',
  'El slug "enterpriseenrollment" está reservado',
  'no se puede crear una empresa con un slug reservado'
);

select * from finish();
rollback;
