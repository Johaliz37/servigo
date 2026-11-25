import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { Button } from '@client/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@client/components/ui/dialog';
import { mediaUrl } from '@client/lib/media-url';

/**
 * Foto ampliada de la galería. Se carga solo al abrirla (`lazy`): el diálogo de Radix no
 * entra en el JS inicial de la ficha (fase 09 §4).
 */
export default function Lightbox({
  title,
  photos,
  index,
  onIndex,
  onClose,
}: {
  title: string;
  photos: { path: string; alt: string | null }[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
}) {
  const go = (delta: number) => onIndex((index + delta + photos.length) % photos.length);
  const photo = photos[index]!;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-[min(96vw,1200px)] border-0 bg-black/95 p-2 text-white sm:max-w-[min(96vw,1200px)] [&>button]:text-white"
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') go(1);
          if (e.key === 'ArrowLeft') go(-1);
        }}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">
          Foto {index + 1} de {photos.length}. Usa las flechas para cambiar de foto.
        </DialogDescription>
        <div className="relative">
          <img
            src={mediaUrl(photo.path) ?? ''}
            alt={photo.alt ?? ''}
            className="mx-auto max-h-[85svh] w-auto rounded-md object-contain"
          />
          {photos.length > 1 && (
            <>
              <Button
                size="icon"
                variant="secondary"
                className="absolute top-1/2 left-2 -translate-y-1/2 rounded-full"
                onClick={() => go(-1)}
                aria-label="Foto anterior"
              >
                <ChevronLeftIcon />
              </Button>
              <Button
                size="icon"
                variant="secondary"
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full"
                onClick={() => go(1)}
                aria-label="Foto siguiente"
              >
                <ChevronRightIcon />
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
