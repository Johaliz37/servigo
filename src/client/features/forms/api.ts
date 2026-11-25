/**
 * Datos de la fase 07: campos de información adicional (`booking_fields`). Escritura directa
 * con RLS (owner/admin); el trigger `booking_fields_validate` garantiza la forma del jsonb.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toBookingField, type BookingField } from '@shared/booking-fields';
import type { Database, Json } from '@shared/database.types';
import { useCompany } from '@client/app/tenant-context';
import { supabase } from '@client/lib/supabase';

type FieldInsert = Database['public']['Tables']['booking_fields']['Insert'];

function forbidden(): Error {
  return Object.assign(new Error('forbidden'), { code: '42501' });
}

export const fieldsKey = (companyId: string) => ['booking-fields', companyId];

const COLUMNS =
  'id, service_id, label, help_text, placeholder, type, options, required, validation, is_active, sort_order';

export function useBookingFields() {
  const company = useCompany();
  return useQuery({
    queryKey: fieldsKey(company.id),
    queryFn: async (): Promise<BookingField[]> => {
      const { data, error } = await supabase
        .from('booking_fields')
        .select(COLUMNS)
        .eq('company_id', company.id)
        .order('sort_order')
        .order('created_at');
      if (error) throw error;
      return data.map(toBookingField);
    },
  });
}

export function useServiceOptions() {
  const company = useCompany();
  return useQuery({
    queryKey: ['catalog-service-options', company.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('catalog_items')
        .select('id, name, is_active')
        .eq('company_id', company.id)
        .eq('kind', 'service')
        .order('sort_order')
        .order('name');
      if (error) throw error;
      return data;
    },
  });
}

/** Columnas editables de un campo (lo que produce `editorToRow`). */
export type FieldRow = Pick<
  BookingField,
  'type' | 'label' | 'help_text' | 'placeholder' | 'required' | 'is_active' | 'options' | 'validation'
>;

function toInsert(companyId: string, serviceId: string | null, row: FieldRow, sortOrder: number): FieldInsert {
  return {
    ...row,
    options: row.options as unknown as NonNullable<Json>,
    validation: row.validation as unknown as NonNullable<Json>,
    company_id: companyId,
    service_id: serviceId,
    sort_order: sortOrder,
  };
}

function nextSort(all: BookingField[], serviceId: string | null): number {
  return Math.max(0, ...all.filter((f) => f.service_id === serviceId).map((f) => f.sort_order)) + 1;
}

function useFieldsMutation<V>(fn: (vars: V, current: BookingField[]) => Promise<unknown>) {
  const company = useCompany();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: V) => fn(vars, queryClient.getQueryData<BookingField[]>(fieldsKey(company.id)) ?? []),
    onSettled: () => queryClient.invalidateQueries({ queryKey: fieldsKey(company.id) }),
  });
}

export function useSaveField() {
  const company = useCompany();
  return useFieldsMutation(
    async ({ id, serviceId, row }: { id?: string; serviceId: string | null; row: FieldRow }, all) => {
      if (id) {
        const { type: _type, ...patch } = row; // el tipo no cambia tras crear el campo
        void _type;
        const { data, error } = await supabase
          .from('booking_fields')
          .update({
            ...patch,
            options: patch.options as unknown as NonNullable<Json>,
            validation: patch.validation as unknown as NonNullable<Json>,
          })
          .eq('id', id)
          .select('id');
        if (error) throw error;
        if (data.length === 0) throw forbidden();
        return;
      }
      const { error } = await supabase
        .from('booking_fields')
        .insert(toInsert(company.id, serviceId, row, nextSort(all, serviceId)));
      if (error) throw error;
    },
  );
}

export function useToggleField() {
  return useFieldsMutation(async ({ id, active }: { id: string; active: boolean }) => {
    const { data, error } = await supabase
      .from('booking_fields')
      .update({ is_active: active })
      .eq('id', id)
      .select('id');
    if (error) throw error;
    if (data.length === 0) throw forbidden();
  });
}

export function useDeleteField() {
  return useFieldsMutation(async (id: string) => {
    const { data, error } = await supabase.from('booking_fields').delete().eq('id', id).select('id');
    if (error) throw error;
    if (data.length === 0) throw forbidden();
  });
}

/** ¿Ya hay reservas que respondieron este campo? (entonces no se borra: se inactiva). */
export function useFieldHasAnswers(fieldId: string | null) {
  return useQuery({
    queryKey: ['field-has-answers', fieldId],
    enabled: !!fieldId,
    queryFn: async (): Promise<boolean> => {
      const { count, error } = await supabase
        .from('booking_answers')
        .select('id', { count: 'exact', head: true })
        .eq('field_id', fieldId as string);
      if (error) throw error;
      return (count ?? 0) > 0;
    },
  });
}

const copyRow = (f: BookingField): FieldRow => ({
  type: f.type,
  label: f.label,
  help_text: f.help_text,
  placeholder: f.placeholder,
  required: f.required,
  is_active: f.is_active,
  options: f.options,
  validation: f.validation,
});

/** Copia del campo justo al final de su grupo. */
export function useDuplicateField() {
  const company = useCompany();
  return useFieldsMutation(async (field: BookingField, all) => {
    const label = `${field.label.slice(0, 191)} (copia)`;
    const { error } = await supabase
      .from('booking_fields')
      .insert(toInsert(company.id, field.service_id, { ...copyRow(field), label }, nextSort(all, field.service_id)));
    if (error) throw error;
  });
}

/** Copia los campos activos de otro grupo (generales o un servicio) al final de `to`. */
export function useCopyFields() {
  const company = useCompany();
  return useFieldsMutation(async ({ from, to }: { from: string | null; to: string | null }, all): Promise<number> => {
    const source = all.filter((f) => f.service_id === from && f.is_active).sort((a, b) => a.sort_order - b.sort_order);
    if (source.length === 0) return 0;
    const start = nextSort(all, to);
    const { error } = await supabase
      .from('booking_fields')
      .insert(source.map((f, i) => toInsert(company.id, to, copyRow(f), start + i)));
    if (error) throw error;
    return source.length;
  });
}
