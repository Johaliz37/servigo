import { useCallback, useRef, useState, type ReactNode } from 'react';
import { SCOPE_LABELS, type Scope } from '@shared/calendar';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@client/components/ui/alert-dialog';
import { Label } from '@client/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@client/components/ui/radio-group';

interface Ask {
  title: string;
  action: string;
  allowThis: boolean;
}

/**
 * Pregunta de Google Calendar al editar o borrar un evento recurrente. `ask()` devuelve el
 * alcance elegido o `null` si se cancela.
 */
export function useScopePrompt(): [ReactNode, (ask: Ask) => Promise<Scope | null>] {
  const [ask, setAsk] = useState<Ask | null>(null);
  const [scope, setScope] = useState<Scope>('this');
  const resolver = useRef<((s: Scope | null) => void) | null>(null);

  const open = useCallback((next: Ask) => {
    setScope(next.allowThis ? 'this' : 'following');
    setAsk(next);
    return new Promise<Scope | null>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = (value: Scope | null) => {
    resolver.current?.(value);
    resolver.current = null;
    setAsk(null);
  };

  const element = (
    <AlertDialog open={!!ask} onOpenChange={(o) => !o && close(null)}>
      <AlertDialogContent className="sm:max-w-sm">
        <AlertDialogHeader>
          <AlertDialogTitle>{ask?.title}</AlertDialogTitle>
        </AlertDialogHeader>
        <RadioGroup value={scope} onValueChange={(v) => setScope(v as Scope)} className="gap-3 py-2">
          {(['this', 'following', 'all'] as const)
            .filter((s) => s !== 'this' || ask?.allowThis)
            .map((s) => (
              <Label key={s} className="flex items-center gap-3 font-normal">
                <RadioGroupItem value={s} /> {SCOPE_LABELS[s]}
              </Label>
            ))}
        </RadioGroup>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => close(null)}>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={() => close(scope)}>{ask?.action ?? 'Aceptar'}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return [element, open];
}
