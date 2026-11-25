-- Fase 07: forma de options/validation, borrado con respuestas y orden de los campos.
-- create_tenant deja un campo 'Notas' (text) con una respuesta.
begin;
select plan(12);

create temp table fx on commit drop as select tests.create_tenant('campos-co') as a;
grant select on fx to authenticated;

select tests.authenticate_as((select (a ->> 'owner')::uuid from fx));

select lives_ok(
  format($$insert into public.booking_fields (company_id, label, type, options, required, validation)
           values (%L, 'Zonas', 'multiselect',
                   '[{"value": "espalda", "label": "Espalda"}, {"value": "cuello", "label": "Cuello"}]',
                   false, '{"min": 1, "max": 2}')$$, (select a ->> 'company' from fx)),
  'una lista con opciones válidas y min/max se guarda');

select throws_ok(
  format($$insert into public.booking_fields (company_id, label, type, options)
           values (%L, 'X', 'radio', '[{"value": "a", "label": "A"}, {"value": "a", "label": "Otra A"}]')$$,
    (select a ->> 'company' from fx)),
  '23514', 'Las opciones de un campo no pueden repetirse',
  'los valores de las opciones son únicos');

select throws_ok(
  format($$insert into public.booking_fields (company_id, label, type, options)
           values (%L, 'X', 'select', '[{"value": "Con Espacios", "label": "A"}]')$$,
    (select a ->> 'company' from fx)),
  '23514', null,
  'el valor de una opción debe ser un identificador estable');

select throws_ok(
  format($$insert into public.booking_fields (company_id, label, type, options)
           values (%L, 'X', 'select', '[{"value": "a"}]')$$, (select a ->> 'company' from fx)),
  '23514', null,
  'cada opción necesita texto');

select throws_ok(
  format($$insert into public.booking_fields (company_id, label, type, options)
           values (%L, 'X', 'text', '[{"value": "a", "label": "A"}]')$$, (select a ->> 'company' from fx)),
  '23514', 'Solo las listas tienen opciones',
  'un campo de texto no tiene opciones');

select throws_ok(
  format($$insert into public.booking_fields (company_id, label, type, validation)
           values (%L, 'X', 'checkbox', '{"maxLength": 10}')$$, (select a ->> 'company' from fx)),
  '23514', null,
  'una validación que no aplica al tipo se rechaza');

select throws_ok(
  format($$insert into public.booking_fields (company_id, label, type, validation)
           values (%L, 'X', 'text', '{"minLength": 10, "maxLength": 5}')$$, (select a ->> 'company' from fx)),
  '23514', 'El mínimo no puede ser mayor que el máximo',
  'mínimo mayor que máximo se rechaza');

select throws_ok(
  format($$insert into public.booking_fields (company_id, label, type, validation)
           values (%L, 'X', 'text', '{"maxLength": "diez"}')$$, (select a ->> 'company' from fx)),
  '23514', null,
  'las longitudes son números');

select lives_ok(
  format($$insert into public.booking_fields (company_id, label, type, validation)
           values (%L, 'Código', 'text', '{"maxLength": 6, "pattern": "^[0-9]+$", "patternMessage": "Solo números"}')$$,
    (select a ->> 'company' from fx)),
  'texto con longitud y patrón se guarda');

-- Borrar ------------------------------------------------------------------------
select throws_ok(
  format('delete from public.booking_fields where id = %L', (select a ->> 'field' from fx)),
  'P0001', 'El campo «Notas» ya tiene respuestas: inactívalo en lugar de borrarlo',
  'un campo con respuestas no se borra');

select is(
  tests.affected_rows(format($$delete from public.booking_fields where company_id = %L and label = 'Código'$$,
    (select a ->> 'company' from fx))),
  1, 'un campo sin respuestas sí se borra');

select lives_ok(
  format($$select public.reorder_rows('booking_fields', array(
    select id from public.booking_fields where company_id = %L order by label))$$, (select a ->> 'company' from fx)),
  'reorder_rows ordena los campos');

select * from finish();
rollback;
