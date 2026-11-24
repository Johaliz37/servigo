import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  ExternalLinkIcon,
  HandshakeIcon,
  ImageIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { sponsorSchema, type SponsorInput, type SponsorValues } from '@shared/content';
import { Badge } from '@client/components/ui/badge';
import { Button } from '@client/components/ui/button';
import { Checkbox } from '@client/components/ui/checkbox';
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
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@client/components/ui/form';
import { Input } from '@client/components/ui/input';
import { Label } from '@client/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@client/components/ui/select';
import { Switch } from '@client/components/ui/switch';
import { Textarea } from '@client/components/ui/textarea';
import { ConfirmDialog } from '@client/components/common/ConfirmDialog';
import { EmptyState } from '@client/components/common/EmptyState';
import { PageHeader } from '@client/components/common/PageHeader';
import { SortableList } from '@client/components/common/SortableList';
import { FullPageSpinner } from '@client/components/common/Spinner';
import { ImageUploader } from '@client/components/media/ImageUploader';
import { useCompany } from '@client/app/tenant-context';
import { messageOf } from '@client/lib/errors';
import { cleanupReplaced, deleteImages, mediaUrl } from '@client/lib/media';
import { RequireAction } from '@client/features/admin/RequireAction';
import {
  sponsorsKey,
  useBranchesAdmin,
  useDeleteSponsor,
  useReorder,
  useUpdateBranch,
  useSaveSponsor,
  useSponsors,
  useToggleVisible,
  type BranchRow,
  type SponsorRow,
} from './api';

export function Component() {
  return (
    <RequireAction action="company.edit">
      <Sponsors />
    </RequireAction>
  );
}

function Sponsors() {
  const branches = useBranchesAdmin();
  const [picked, setBranchId] = useState<string | null>(null);
  // Sin elección explícita, la primera sede.
  const branchId = picked ?? branches.data?.[0]?.id ?? null;

  if (branches.isPending) return <FullPageSpinner />;
  if (branches.isError) throw branches.error;
  const branch = branches.data.find((b) => b.id === branchId) ?? null;

  return (
    <>
      <PageHeader
        title="Patrocinadores"
        description="Marcas aliadas que se muestran en la página de cada sede."
        actions={
          <div className="flex items-center gap-2">
            <Label htmlFor="sponsor-branch" className="text-sm">
              Sede
            </Label>
            <Select value={branchId ?? undefined} onValueChange={setBranchId}>
              <SelectTrigger id="sponsor-branch" className="w-52">
                <SelectValue placeholder="Elige una sede" />
              </SelectTrigger>
              <SelectContent>
                {branches.data.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      />
      {branch && <BranchSponsors branch={branch} branches={branches.data} />}
    </>
  );
}

function BranchSponsors({ branch, branches }: { branch: BranchRow; branches: BranchRow[] }) {
  const company = useCompany();
  const key = sponsorsKey(company.id, branch.id);
  const sponsors = useSponsors(branch.id);
  const reorder = useReorder('sponsors', key);
  const toggle = useToggleVisible('sponsors', ['sponsors', company.id]);
  const remove = useDeleteSponsor();
  const saveBranch = useUpdateBranch();
  const [editing, setEditing] = useState<SponsorRow | 'new' | null>(null);
  const [deleting, setDeleting] = useState<SponsorRow | null>(null);

  /** Interruptor de sección: se guarda en la sede (branches.show_sponsors). */
  function setSection(show: boolean) {
    saveBranch.mutate(
      { id: branch.id, patch: { show_sponsors: show } },
      {
        onSuccess: () => toast.success(show ? 'Sección visible' : 'Sección oculta'),
        onError: (e) => toast.error(messageOf(e)),
      },
    );
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
        <div className="space-y-1">
          <Label htmlFor="show-sponsors">Mostrar sección de patrocinadores en {branch.name}</Label>
          <p className="text-sm text-muted-foreground">
            Si está apagado, no se muestra aunque haya patrocinadores visibles.
          </p>
        </div>
        <Switch
          id="show-sponsors"
          checked={branch.show_sponsors}
          disabled={saveBranch.isPending}
          onCheckedChange={setSection}
        />
      </div>

      <div className="flex justify-end">
        <Button onClick={() => setEditing('new')}>
          <PlusIcon aria-hidden /> Nuevo patrocinador
        </Button>
      </div>

      {sponsors.isPending ? (
        <FullPageSpinner />
      ) : sponsors.isError ? (
        <p className="text-sm text-destructive">{messageOf(sponsors.error)}</p>
      ) : sponsors.data.length === 0 ? (
        <EmptyState icon={HandshakeIcon} title={`${branch.name} no tiene patrocinadores`} />
      ) : (
        <SortableList
          items={sponsors.data}
          label={(s) => s.name}
          disabled={reorder.isPending}
          onReorder={(ids) => reorder.mutate(ids, { onError: (e) => toast.error(messageOf(e)) })}
          renderItem={(s, handle) => {
            const img = mediaUrl(s.image_path, 'thumb');
            return (
              <div className="flex items-center gap-3 rounded-lg border bg-card p-3">
                {handle}
                <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-white">
                  {img ? (
                    <img src={img} alt="" className="size-full object-contain" />
                  ) : (
                    <ImageIcon className="size-5 text-muted-foreground" aria-hidden />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{s.name}</p>
                  {s.description && <p className="truncate text-sm text-muted-foreground">{s.description}</p>}
                  {!s.is_visible && (
                    <Badge variant="secondary" className="mt-1">
                      Oculto
                    </Badge>
                  )}
                </div>
                <Switch
                  checked={s.is_visible}
                  aria-label={`${s.name} visible`}
                  onCheckedChange={(visible) =>
                    toggle.mutate({ id: s.id, visible }, { onError: (e) => toast.error(messageOf(e)) })
                  }
                />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label={`Acciones de ${s.name}`}>
                      <MoreHorizontalIcon />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setEditing(s)}>
                      <PencilIcon aria-hidden /> Editar
                    </DropdownMenuItem>
                    {s.url && (
                      <DropdownMenuItem asChild>
                        <a href={s.url} target="_blank" rel="noopener noreferrer">
                          <ExternalLinkIcon aria-hidden /> Abrir enlace
                        </a>
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(s)}>
                      <Trash2Icon aria-hidden /> Borrar
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            );
          }}
        />
      )}

      <SponsorDialog
        sponsor={editing === 'new' ? null : editing}
        open={editing !== null}
        currentBranch={branch}
        branches={branches}
        onOpenChange={(open) => !open && setEditing(null)}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`¿Borrar ${deleting?.name ?? ''}?`}
        description="Se quita de esta sede. No se puede deshacer."
        confirmLabel="Borrar"
        destructive
        onConfirm={async () => {
          if (!deleting) return;
          await remove.mutateAsync(deleting.id);
          await deleteImages([deleting.image_path]);
          toast.success('Patrocinador borrado');
        }}
      />
    </div>
  );
}

function toForm(s: SponsorRow | null): SponsorInput {
  return {
    name: s?.name ?? '',
    description: s?.description ?? '',
    url: s?.url ?? '',
    image_path: s?.image_path ?? null,
    is_visible: s?.is_visible ?? true,
  };
}

type SponsorDialogProps = {
  sponsor: SponsorRow | null;
  open: boolean;
  currentBranch: BranchRow;
  branches: BranchRow[];
  onOpenChange: (open: boolean) => void;
};

/** El formulario se monta de nuevo en cada apertura (estado inicial limpio). */
function SponsorDialog(props: SponsorDialogProps) {
  if (!props.open) return null;
  return <SponsorDialogBody key={props.sponsor?.id ?? 'new'} {...props} />;
}

function SponsorDialogBody({ sponsor, open, currentBranch, branches, onOpenChange }: SponsorDialogProps) {
  const save = useSaveSponsor();
  const [targets, setTargets] = useState<string[]>([currentBranch.id]);
  const form = useForm<SponsorInput, unknown, SponsorValues>({
    resolver: zodResolver(sponsorSchema),
    defaultValues: toForm(sponsor),
  });

  async function submit(values: SponsorValues) {
    if (!sponsor && targets.length === 0) {
      form.setError('root', { message: 'Elige al menos una sede' });
      return;
    }
    try {
      await save.mutateAsync({ id: sponsor?.id, branchIds: targets, values });
      // Al crear no hay imagen anterior que limpiar (cada sede recibe su propia copia).
      if (sponsor) await cleanupReplaced([sponsor.image_path], [values.image_path]);
      toast.success(
        sponsor
          ? 'Patrocinador guardado'
          : targets.length > 1
            ? `Creado en ${targets.length} sedes`
            : 'Patrocinador creado',
      );
      onOpenChange(false);
    } catch (error) {
      form.setError('root', { message: messageOf(error) });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !form.formState.isSubmitting && onOpenChange(o)}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{sponsor ? `Editar ${sponsor.name}` : 'Nuevo patrocinador'}</DialogTitle>
          <DialogDescription>
            {sponsor ? `En ${currentBranch.name}.` : 'Puedes crearlo en varias sedes a la vez.'}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form id="sponsor-form" onSubmit={form.handleSubmit(submit)} className="space-y-4" noValidate>
            <FormField
              control={form.control}
              name="image_path"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Logo</FormLabel>
                  <ImageUploader
                    value={field.value}
                    onChange={field.onChange}
                    entity="sponsors"
                    label="Logo"
                    hint="Proporción libre. Mejor con fondo transparente o blanco."
                  />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Descripción</FormLabel>
                  <FormControl>
                    <Textarea rows={2} {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="url"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Enlace (opcional)</FormLabel>
                  <FormControl>
                    <Input type="url" placeholder="https://…" {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="is_visible"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between gap-4 rounded-lg border p-3">
                  <div className="space-y-1">
                    <FormLabel>Visible</FormLabel>
                    <FormDescription>Ocúltalo sin borrarlo.</FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />
            {!sponsor && branches.length > 1 && (
              <fieldset className="space-y-2 rounded-lg border p-3">
                <legend className="px-1 text-sm font-medium">Aplicar a varias sedes</legend>
                {branches.map((b) => (
                  <label key={b.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={targets.includes(b.id)}
                      onCheckedChange={(checked) =>
                        setTargets((t) => (checked ? [...new Set([...t, b.id])] : t.filter((id) => id !== b.id)))
                      }
                    />
                    {b.name}
                  </label>
                ))}
                <p className="text-xs text-muted-foreground">Se crea una copia independiente en cada sede.</p>
              </fieldset>
            )}
            {form.formState.errors.root && (
              <p role="alert" className="text-sm text-destructive">
                {form.formState.errors.root.message}
              </p>
            )}
          </form>
        </Form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={form.formState.isSubmitting}>
            Cancelar
          </Button>
          <Button type="submit" form="sponsor-form" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? 'Guardando…' : 'Guardar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
