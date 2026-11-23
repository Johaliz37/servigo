import { useEffect, useId, useState } from 'react';
import { ImageIcon, XIcon } from 'lucide-react';
import { Button } from '@client/components/ui/button';

export const ACCEPTED_IMAGE_TYPES = ['image/webp', 'image/jpeg', 'image/png', 'image/svg+xml'];
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // igual que el bucket `media` (02)

/**
 * Selector de imagen con vista previa. La fase 05 añade compresión a WebP, miniatura y
 * subida a Storage; aquí solo valida tipo y tamaño y entrega el archivo.
 */
export function ImageUploader({
  value,
  onChange,
  label = 'Imagen',
  onError,
}: {
  /** URL actual (p. ej. la imagen ya guardada). */
  value?: string | null;
  onChange: (file: File | null) => void;
  label?: string;
  onError?: (message: string) => void;
}) {
  const inputId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  // Libera el object URL al cambiarlo o al desmontar.
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  function pick(next: File | null) {
    if (next && !ACCEPTED_IMAGE_TYPES.includes(next.type)) {
      onError?.('Formato no permitido: usa WebP, JPG, PNG o SVG.');
      return;
    }
    if (next && next.size > MAX_IMAGE_BYTES) {
      onError?.('La imagen pesa más de 2 MB.');
      return;
    }
    setFile(next);
    setPreview(next ? URL.createObjectURL(next) : null);
    onChange(next);
  }

  const shown = preview ?? value ?? null;

  return (
    <div className="flex items-center gap-4">
      <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted">
        {shown ? (
          <img src={shown} alt="" className="size-full object-contain" />
        ) : (
          <ImageIcon className="size-8 text-muted-foreground" aria-hidden />
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" asChild>
          <label htmlFor={inputId} className="cursor-pointer">
            {shown ? 'Cambiar' : 'Elegir'} {label.toLowerCase()}
          </label>
        </Button>
        <input
          id={inputId}
          type="file"
          accept={ACCEPTED_IMAGE_TYPES.join(',')}
          className="sr-only"
          onChange={(e) => pick(e.target.files?.[0] ?? null)}
        />
        {file && (
          <Button variant="ghost" size="sm" onClick={() => pick(null)}>
            <XIcon aria-hidden /> Quitar
          </Button>
        )}
      </div>
    </div>
  );
}
