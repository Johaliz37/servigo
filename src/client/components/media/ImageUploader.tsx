import { useCallback, useId, useState, type DragEvent } from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import { ImageIcon, Loader2Icon, Trash2Icon, UploadIcon } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { MEDIA_INPUT_TYPES, MEDIA_SOFT_QUOTA_BYTES, validateImageFile, type MediaEntity } from '@shared/content';
import { Button } from '@client/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@client/components/ui/dialog';
import { useCompany } from '@client/app/tenant-context';
import { messageOf } from '@client/lib/errors';
import { mediaUrl, processImage, uploadImage, useStorageUsage, type CropArea } from '@client/lib/media';
import { cn } from '@client/lib/utils';

export interface ImageUploaderProps {
  /** Ruta guardada en `media` (o null). */
  value: string | null;
  /** Nueva ruta ya subida, o null al quitar. Las imágenes viejas se borran al guardar el formulario. */
  onChange: (path: string | null) => void;
  entity: MediaEntity;
  label: string;
  /** Relación de aspecto del recorte (1 = logo, 16/9 = portada). Sin valor: libre, con opción de imagen completa. */
  aspect?: number;
  /** Texto de ayuda bajo el botón. */
  hint?: string;
  disabled?: boolean;
  className?: string;
}

/** Selector de imagen con arrastrar/soltar, recorte, compresión a WebP y subida a Storage (fase 05 §1). */
export function ImageUploader({
  value,
  onChange,
  entity,
  label,
  aspect,
  hint,
  disabled,
  className,
}: ImageUploaderProps) {
  const company = useCompany();
  const inputId = useId();
  const queryClient = useQueryClient();
  const usage = useStorageUsage(company.id);
  // Archivo elegido y su URL temporal (se crea al elegir y se libera al terminar o cancelar).
  const [pending, setPending] = useState<{ file: File; src: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const overQuota = (usage.data ?? 0) >= MEDIA_SOFT_QUOTA_BYTES;
  const blocked = disabled || busy || overQuota;

  function pick(next: File | undefined | null) {
    setError(null);
    if (!next) return;
    const invalid = validateImageFile(next);
    if (invalid) {
      setError(invalid);
      return;
    }
    setPending({ file: next, src: URL.createObjectURL(next) });
  }

  function clearPending() {
    if (pending) URL.revokeObjectURL(pending.src);
    setPending(null);
  }

  async function upload(crop: CropArea | null) {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      const images = await processImage(pending.file, crop);
      const path = await uploadImage(company.id, entity, images);
      onChange(path);
      void queryClient.invalidateQueries({ queryKey: ['storage-usage', company.id] });
      clearPending();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (!blocked) pick(e.dataTransfer.files[0]);
  }

  const shown = mediaUrl(value);
  const wide = aspect !== undefined && aspect > 1.2;

  return (
    <div className={cn('space-y-2', className)}>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!blocked) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'flex flex-wrap items-center gap-4 rounded-lg border border-dashed p-3 transition-colors',
          dragging && 'border-primary bg-primary/5',
        )}
      >
        <div
          className={cn(
            'flex shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted',
            wide ? 'aspect-video w-32' : 'size-20',
          )}
        >
          {busy ? (
            <Loader2Icon className="size-6 animate-spin text-muted-foreground" aria-label="Subiendo" />
          ) : shown ? (
            <img src={shown} alt={label} className="size-full object-cover" />
          ) : (
            <ImageIcon className="size-7 text-muted-foreground" aria-hidden />
          )}
        </div>
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" disabled={blocked} asChild={!blocked}>
              {blocked ? (
                <span>
                  <UploadIcon aria-hidden /> {shown ? 'Cambiar' : 'Subir'} {label.toLowerCase()}
                </span>
              ) : (
                <label htmlFor={inputId} className="cursor-pointer">
                  <UploadIcon aria-hidden /> {shown ? 'Cambiar' : 'Subir'} {label.toLowerCase()}
                </label>
              )}
            </Button>
            {value && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy || disabled}
                onClick={() => onChange(null)}
              >
                <Trash2Icon aria-hidden /> Quitar
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {hint ?? 'Arrastra una imagen o elígela. JPG, PNG o WebP; se optimiza automáticamente.'}
          </p>
          <input
            id={inputId}
            type="file"
            aria-label={label}
            accept={MEDIA_INPUT_TYPES.join(',')}
            className="sr-only"
            disabled={blocked}
            onChange={(e) => {
              pick(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>
      </div>
      {overQuota && (
        <p role="alert" className="text-sm text-destructive">
          La empresa alcanzó su espacio de imágenes (100 MB). Borra imágenes que no uses para subir nuevas.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {pending && (
        <CropDialog
          key={pending.src}
          src={pending.src}
          aspect={aspect}
          busy={busy}
          title={label}
          onCancel={clearPending}
          onConfirm={(crop) => void upload(crop)}
        />
      )}
    </div>
  );
}

function CropDialog({
  src,
  aspect,
  busy,
  title,
  onCancel,
  onConfirm,
}: {
  src: string;
  aspect?: number;
  busy: boolean;
  title: string;
  onCancel: () => void;
  onConfirm: (crop: CropArea | null) => void;
}) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [naturalAspect, setNaturalAspect] = useState(1);

  const onComplete = useCallback((_: Area, pixels: Area) => setArea(pixels), []);

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onCancel()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Recortar {title.toLowerCase()}</DialogTitle>
          <DialogDescription>Arrastra para encuadrar y usa el control para acercar.</DialogDescription>
        </DialogHeader>
        <div className="relative h-72 overflow-hidden rounded-md bg-muted">
          <Cropper
            image={src}
            crop={crop}
            zoom={zoom}
            aspect={aspect ?? naturalAspect}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onComplete}
            onMediaLoaded={(m) => setNaturalAspect(m.naturalWidth / m.naturalHeight)}
          />
        </div>
        <label className="flex items-center gap-3 text-sm">
          Zoom
          <input
            type="range"
            min={1}
            max={4}
            step={0.05}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="flex-1 accent-primary"
          />
        </label>
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
            Cancelar
          </Button>
          {aspect === undefined && (
            <Button type="button" variant="secondary" disabled={busy} onClick={() => onConfirm(null)}>
              Usar imagen completa
            </Button>
          )}
          <Button type="button" disabled={busy || !area} onClick={() => onConfirm(area)}>
            {busy ? 'Optimizando…' : 'Usar imagen'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
