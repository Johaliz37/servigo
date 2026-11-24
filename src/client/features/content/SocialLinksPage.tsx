import { useState } from 'react';
import { InfoIcon, MoreHorizontalIcon, PencilIcon, PlusIcon, Share2Icon, Trash2Icon } from 'lucide-react';
import { toast } from 'sonner';
import {
  displaySocialUrl,
  normalizeSocialUrl,
  SOCIAL_LABELS,
  SOCIAL_NETWORKS,
  SOCIAL_PLACEHOLDERS,
  type SocialNetwork,
} from '@shared/content';
import { Alert, AlertDescription } from '@client/components/ui/alert';
import { Badge } from '@client/components/ui/badge';
import { Button } from '@client/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@client/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@client/components/ui/dropdown-menu';
import { Input } from '@client/components/ui/input';
import { Label } from '@client/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@client/components/ui/select';
import { Switch } from '@client/components/ui/switch';
import { ConfirmDialog } from '@client/components/common/ConfirmDialog';
import { EmptyState } from '@client/components/common/EmptyState';
import { PageHeader } from '@client/components/common/PageHeader';
import { SocialIcon } from '@client/components/common/SocialIcon';
import { SortableList } from '@client/components/common/SortableList';
import { FullPageSpinner } from '@client/components/common/Spinner';
import { useCompany } from '@client/app/tenant-context';
import { messageOf } from '@client/lib/errors';
import { RequireAction } from '@client/features/admin/RequireAction';
import {
  socialKey,
  useBranchesAdmin,
  useDeleteSocialLink,
  useReorder,
  useSaveSocialLink,
  useSocialLinks,
  useToggleVisible,
  type SocialLinkRow,
} from './api';

const COMPANY = 'company';

export function Component() {
  return (
    <RequireAction action="company.edit">
      <SocialLinks />
    </RequireAction>
  );
}

function SocialLinks() {
  const company = useCompany();
  const branches = useBranchesAdmin();
  const links = useSocialLinks();
  const [scope, setScope] = useState<string>(COMPANY);
  const reorder = useReorder('social_links', socialKey(company.id));
  const toggle = useToggleVisible('social_links', socialKey(company.id));
  const remove = useDeleteSocialLink();
  const [editing, setEditing] = useState<SocialLinkRow | 'new' | null>(null);
  const [deleting, setDeleting] = useState<SocialLinkRow | null>(null);

  const branchId = scope === COMPANY ? null : scope;
  const all = links.data ?? [];
  const companyLinks = all.filter((l) => l.branch_id === null);
  const scoped = all.filter((l) => l.branch_id === branchId);

  if (branches.isPending || links.isPending) return <FullPageSpinner />;
  if (branches.isError) throw branches.error;
  if (links.isError) throw links.error;
  const branchName = branches.data.find((b) => b.id === branchId)?.name;

  return (
    <>
      <PageHeader
        title="Redes sociales"
        description="Enlaces que se muestran en el pie de página y en la página de cada sede."
        actions={
          <div className="flex items-center gap-2">
            <Label htmlFor="social-scope" className="text-sm">
              Mostrar
            </Label>
            <Select value={scope} onValueChange={setScope}>
              <SelectTrigger id="social-scope" className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={COMPANY}>Empresa (todas las sedes)</SelectItem>
                {branches.data.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    Sede: {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      />
      <div className="max-w-3xl space-y-4">
        <Alert>
          <InfoIcon aria-hidden />
          <AlertDescription>
            {branchId === null
              ? 'Las redes de la empresa aparecen en todas las sedes, salvo en las que definan las suyas.'
              : scoped.length > 0
                ? `${branchName} tiene redes propias: en su página reemplazan a las de la empresa.`
                : `${branchName} no tiene redes propias: usa las de la empresa (${companyLinks.length}). Si añades una, solo se mostrarán las de la sede.`}
          </AlertDescription>
        </Alert>

        <div className="flex justify-end">
          <Button onClick={() => setEditing('new')}>
            <PlusIcon aria-hidden /> Añadir red
          </Button>
        </div>

        {scoped.length === 0 ? (
          <EmptyState
            icon={Share2Icon}
            title={branchId ? `Sin redes propias en ${branchName}` : 'Sin redes de la empresa'}
          />
        ) : (
          <SortableList
            items={scoped}
            label={(l) => SOCIAL_LABELS[l.network]}
            disabled={reorder.isPending}
            onReorder={(ids) => reorder.mutate(ids, { onError: (e) => toast.error(messageOf(e)) })}
            renderItem={(l, handle) => (
              <div className="flex items-center gap-3 rounded-lg border bg-card p-3">
                {handle}
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
                  <SocialIcon network={l.network} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{l.label || SOCIAL_LABELS[l.network]}</p>
                  <p className="truncate text-sm text-muted-foreground">{displaySocialUrl(l.url)}</p>
                  {!l.is_visible && (
                    <Badge variant="secondary" className="mt-1">
                      Oculta
                    </Badge>
                  )}
                </div>
                <Switch
                  checked={l.is_visible}
                  aria-label={`${SOCIAL_LABELS[l.network]} visible`}
                  onCheckedChange={(visible) =>
                    toggle.mutate({ id: l.id, visible }, { onError: (e) => toast.error(messageOf(e)) })
                  }
                />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label={`Acciones de ${SOCIAL_LABELS[l.network]}`}>
                      <MoreHorizontalIcon />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setEditing(l)}>
                      <PencilIcon aria-hidden /> Editar
                    </DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(l)}>
                      <Trash2Icon aria-hidden /> Borrar
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          />
        )}
      </div>

      <SocialDialog
        link={editing === 'new' ? null : editing}
        open={editing !== null}
        branchId={branchId}
        scopeName={branchName ?? 'la empresa'}
        onOpenChange={(open) => !open && setEditing(null)}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="¿Borrar este enlace?"
        description={deleting ? `${SOCIAL_LABELS[deleting.network]}: ${displaySocialUrl(deleting.url)}` : undefined}
        confirmLabel="Borrar"
        destructive
        onConfirm={async () => {
          if (!deleting) return;
          await remove.mutateAsync(deleting.id);
          toast.success('Enlace borrado');
        }}
      />
    </>
  );
}

type SocialDialogProps = {
  link: SocialLinkRow | null;
  open: boolean;
  branchId: string | null;
  scopeName: string;
  onOpenChange: (open: boolean) => void;
};

/** El formulario se monta de nuevo en cada apertura (estado inicial limpio). */
function SocialDialog(props: SocialDialogProps) {
  if (!props.open) return null;
  return <SocialDialogBody key={props.link?.id ?? 'new'} {...props} />;
}

function SocialDialogBody({ link, open, branchId, scopeName, onOpenChange }: SocialDialogProps) {
  const save = useSaveSocialLink();
  const [network, setNetwork] = useState<SocialNetwork>(link?.network ?? 'instagram');
  const [label, setLabel] = useState(link?.label ?? '');
  const [url, setUrl] = useState(link ? displayForEdit(link.network, link.url) : '');
  const [visible, setVisible] = useState(link?.is_visible ?? true);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalized = normalizeSocialUrl(network, url);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!normalized.ok) return;
    try {
      await save.mutateAsync({
        id: link?.id,
        branchId,
        values: { network, label: label.trim() || null, url: normalized.url, is_visible: visible },
      });
      toast.success('Enlace guardado');
      onOpenChange(false);
    } catch (err) {
      setError(messageOf(err));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !save.isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{link ? 'Editar enlace' : 'Añadir red'}</DialogTitle>
          <DialogDescription>De {scopeName}.</DialogDescription>
        </DialogHeader>
        <form id="social-form" onSubmit={submit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="social-network">Red</Label>
            <Select value={network} onValueChange={(v) => setNetwork(v as SocialNetwork)}>
              <SelectTrigger id="social-network" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SOCIAL_NETWORKS.map((n) => (
                  <SelectItem key={n} value={n}>
                    <SocialIcon network={n} /> {SOCIAL_LABELS[n]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="social-url">
              {network === 'whatsapp'
                ? 'Número o enlace'
                : network === 'email'
                  ? 'Correo'
                  : network === 'phone'
                    ? 'Teléfono'
                    : 'Enlace'}
            </Label>
            <Input
              id="social-url"
              value={url}
              placeholder={SOCIAL_PLACEHOLDERS[network]}
              aria-invalid={touched && !normalized.ok}
              aria-describedby="social-url-hint"
              onChange={(e) => setUrl(e.target.value)}
              onBlur={() => setTouched(true)}
            />
            <p
              id="social-url-hint"
              className={touched && !normalized.ok ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}
            >
              {normalized.ok ? `Se guardará como: ${normalized.url}` : touched ? normalized.error : ' '}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="social-label">Texto (opcional)</Label>
            <Input
              id="social-label"
              value={label}
              placeholder={SOCIAL_LABELS[network]}
              maxLength={60}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <Label htmlFor="social-visible">Visible</Label>
            <Switch id="social-visible" checked={visible} onCheckedChange={setVisible} />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            Cancelar
          </Button>
          <Button type="submit" form="social-form" disabled={save.isPending}>
            {save.isPending ? 'Guardando…' : 'Guardar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Al editar se muestra lo que escribiría una persona (número, correo), no la URL técnica. */
function displayForEdit(network: SocialNetwork, url: string): string {
  if (network === 'whatsapp') return url.replace(/^https:\/\/wa\.me\//, '+');
  if (network === 'email') return url.replace(/^mailto:/, '');
  if (network === 'phone') return url.replace(/^tel:/, '');
  return url;
}
