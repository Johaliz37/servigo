import {
  AlignLeftIcon,
  CalendarIcon,
  CircleDotIcon,
  HashIcon,
  ListChecksIcon,
  ListIcon,
  SquareCheckIcon,
  TypeIcon,
  type LucideIcon,
} from 'lucide-react';
import type { FieldType } from '@shared/booking-fields';

export const FIELD_ICONS: Record<FieldType, LucideIcon> = {
  text: TypeIcon,
  textarea: AlignLeftIcon,
  select: ListIcon,
  multiselect: ListChecksIcon,
  radio: CircleDotIcon,
  checkbox: SquareCheckIcon,
  number: HashIcon,
  date: CalendarIcon,
};
