import { Loader2Icon } from 'lucide-react';
import { cn } from '@client/lib/utils';

export function Spinner({ className, label = 'Cargando…' }: { className?: string; label?: string }) {
  return (
    <span role="status" className={cn('inline-flex items-center gap-2 text-sm text-muted-foreground', className)}>
      <Loader2Icon className="size-4 animate-spin" aria-hidden />
      <span>{label}</span>
    </span>
  );
}

export function FullPageSpinner({ label }: { label?: string }) {
  return (
    <div className="flex min-h-svh items-center justify-center">
      <Spinner {...(label ? { label } : {})} />
    </div>
  );
}
