import type { Country } from 'react-phone-number-input/min';
import { useCompany } from '@client/app/tenant-context';

/** País por defecto: el de la configuración regional de la empresa («es-CO» → CO). */
export function useDefaultCountry(): Country {
  const company = useCompany();
  const region = company.locale.split('-')[1]?.toUpperCase();
  return (region && region.length === 2 ? region : 'CO') as Country;
}
