import { useState } from 'react';
import { BuildingIcon, MoreHorizontalIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@client/components/ui/badge';
import { Button } from '@client/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@client/components/ui/dropdown-menu';
import { Switch } from '@client/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@client/components/ui/tooltip';
import { ConfirmDialog } from '@client/components/common/ConfirmDialog';
import { EmptyState } from '@client/components/common/EmptyState';
import { PageHeader } from '@client/components/common/PageHeader';
import { SortableList } from '@client/components/common/SortableList';
import { FullPageSpinner } from '@client/components/common/Spinner';
import { useCompany } from '@client/app/tenant-context';
import { messageOf } from '@client/lib/errors';
import { mediaUrl } from '@client/lib/media';
import { RequireAction } from '@client/features/admin/RequireAction';
import {
  useBranchesAdmin,
  useBranchHasBookings,
  useDeleteBranch,
  useReorder,
  useUpdateBranch,
  type BranchRow,
} from '@client/features/content/api';
import { BranchSheet } from './BranchSheet';

export function Component() {
  return (
    <RequireAction action="company.edit">
      <Branches />
    </RequireAction>
  );
}

function Branches() {
  const company = useCompany();
  const branches = useBranchesAdmin();
  const reorder = useReorder('branches', ['branches-admin', company.id]);
  const setActive = useUpdateBranch();
  const [editing, setEditing] = useState<BranchRow | 'new' | null>(null);
  const [deleting, setDeleting] = useState<BranchRow | null>(null);

  if (branches.isPending) return <FullPageSpinner />;
  if (branches.isError) throw branches.error;
  const rows = branches.data;
  const activeCount = rows.filter((b) => b.is_active).length;

  function toggle(branch: BranchRow, active: boolean) {
    setActive.mutate(
      { id: branch.id, patch: { is_active: active } },
      {
        onSuccess: () => toast.success(active ? `${branch.name} activada` : `${branch.name} inactivada`),
        onError: (e) => toast.error(messageOf(e)),
      },
    );
  }

  return (
    <>
      <PageHeader
        title="Sedes"
        description="Cada sede tiene su dirección, imágenes y, si quieres, su propio horario y catálogo. Arrastra para ordenarlas."
        actions={
          <Button onClick={() => setEditing('new')}>
            <PlusIcon aria-hidden /> Nueva sede
          </Button>
        }
      />
      {rows.length === 0 ? (
        <EmptyState icon={BuildingIcon} title="Aún no hay sedes" />
      ) : (
        <SortableList
          items={rows}
          label={(b) => b.name}
          disabled={reorder.isPending}
          onReorder={(ids) => reorder.mutate(ids, { onError: (e) => toast.error(messageOf(e)) })}
          renderItem={(branch, handle) => {
            const lastActive = branch.is_active && activeCount === 1;
            const cover = mediaUrl(branch.cover_image_path, 'thumb');
            return (
              <div className="flex items-center gap-3 rounded-lg border bg-card p-3" data-testid="branch-card">
                {handle}
                <div className="flex aspect-video w-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted sm:w-24">
                  {cover ? (
                    <img src={cover} alt="" className="size-full object-cover" />
                  ) : (
                    <BuildingIcon className="size-6 text-muted-foreground" aria-hidden />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{branch.name}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {[branch.city, branch.address].filter(Boolean).join(' · ') || `/${branch.slug}`}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {!branch.is_active && <Badge variant="secondary">Inactiva</Badge>}
                    {branch.own_availability && <Badge variant="outline">Horario propio</Badge>}
                    {branch.own_catalog && <Badge variant="outline">Catálogo propio</Badge>}
                  </div>
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <Switch
                        checked={branch.is_active}
                        disabled={lastActive || setActive.isPending}
                        onCheckedChange={(v) => toggle(branch, v)}
                        aria-label={`${branch.name} activa`}
                      />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    {lastActive ? 'Debe quedar al menos una sede activa' : branch.is_active ? 'Inactivar' : 'Activar'}
                  </TooltipContent>
                </Tooltip>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label={`Acciones de ${branch.name}`}>
                      <MoreHorizontalIcon />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setEditing(branch)}>
                      <PencilIcon aria-hidden /> Editar
                    </DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" disabled={lastActive} onSelect={() => setDeleting(branch)}>
                      <Trash2Icon aria-hidden /> Borrar
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            );
          }}
        />
      )}
      <BranchSheet
        branch={editing === 'new' ? null : editing}
        open={editing !== null}
        nextSortOrder={rows.length + 1}
        onOpenChange={(open) => !open && setEditing(null)}
      />
      <DeleteBranchDialog branch={deleting} onClose={() => setDeleting(null)} onInactivate={(b) => toggle(b, false)} />
    </>
  );
}

function DeleteBranchDialog({
  branch,
  onClose,
  onInactivate,
}: {
  branch: BranchRow | null;
  onClose: () => void;
  onInactivate: (b: BranchRow) => void;
}) {
  const hasBookings = useBranchHasBookings(branch?.id ?? null);
  const remove = useDeleteBranch();
  if (!branch) return null;

  if (hasBookings.data) {
    return (
      <ConfirmDialog
        open
        onOpenChange={(o) => !o && onClose()}
        title={`${branch.name} tiene reservas`}
        description="Una sede con reservas no se puede borrar, para no perder su historial. Puedes inactivarla: dejará de aparecer en el sitio."
        confirmLabel={branch.is_active ? 'Inactivar sede' : 'Entendido'}
        onConfirm={() => {
          if (branch.is_active) onInactivate(branch);
        }}
      />
    );
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`¿Borrar ${branch.name}?`}
      description="Se borran también su Acerca de, patrocinadores y redes propias. No se puede deshacer."
      confirmLabel={hasBookings.isPending ? 'Comprobando…' : 'Borrar sede'}
      destructive
      onConfirm={async () => {
        if (hasBookings.isPending) throw new Error('Espera un momento e inténtalo de nuevo.');
        await remove.mutateAsync(branch);
        toast.success(`${branch.name} borrada`);
      }}
    />
  );
}
