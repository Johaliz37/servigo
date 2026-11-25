import { forwardRef, type ComponentProps } from 'react';
import PhoneInput from 'react-phone-number-input/min';
import es from 'react-phone-number-input/locale/es.json';
import 'react-phone-number-input/style.css';
import './phone.css';
import { Input } from '@client/components/ui/input';
import { cn } from '@client/lib/utils';
import { useDefaultCountry } from './country';

const TextInput = forwardRef<HTMLInputElement, ComponentProps<'input'>>(function TextInput(props, ref) {
  return <Input ref={ref} {...props} />;
});

/** Código del país en lugar de la bandera: las banderas por defecto se descargan de una CDN externa. */
function CountryCode({ country }: { country?: string }) {
  return <span className="text-xs font-medium text-muted-foreground">{country ?? '🌐'}</span>;
}

/**
 * Teléfono con selector de país; entrega el número en E.164 (`+573001234567`) o `undefined`.
 */
export function PhoneField({
  value,
  onChange,
  id,
  invalid,
  ...rest
}: {
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  id?: string;
  invalid?: boolean;
  onBlur?: () => void;
  name?: string;
  'aria-describedby'?: string;
}) {
  const country = useDefaultCountry();
  return (
    <PhoneInput
      {...rest}
      id={id}
      value={value}
      onChange={onChange}
      defaultCountry={country}
      labels={es}
      international={false}
      countryCallingCodeEditable={false}
      inputComponent={TextInput}
      flagComponent={CountryCode}
      autoComplete="tel"
      aria-invalid={invalid || undefined}
      className={cn(
        'flex items-center gap-2 [&_.PhoneInputCountry]:h-9 [&_.PhoneInputCountry]:rounded-md [&_.PhoneInputCountry]:border [&_.PhoneInputCountry]:px-2',
      )}
    />
  );
}
