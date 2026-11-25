import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  CopyIcon,
  GripVerticalIcon,
  ImageIcon,
  MoreHorizontalIcon,
  PackageIcon,
  PencilIcon,
  PlusIcon,
  ScissorsIcon,
  SearchIcon,
  StarIcon,
  Trash2Icon,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatDuration, KIND_LABELS, type CatalogKind } from '@shared/catalog';
import { priceAt } from '@shared/pricing';
import { Badge } from '@client/components/ui/badge';
import { Button } from '@client/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@client/components/ui/dropdown-menu';
import { Input } from '@client/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@client/components/ui/select';
import { Switch } from '@client/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@client/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@client/components/ui/tooltip';
import { EmptyState } from '@client/components/common/EmptyState';
import { PageHeader } from '@client/components/common/PageHeader';
import { restrictToVerticalAxis } from '@client/components/common/sortable-modifiers';
import { FullPageSpinner } from '@client/components/common/Spinner';
import { useCompany } from '@client/app/tenant-context';
import { messageOf } from '@client/lib/errors';
import { mediaUrl } from '@client/lib/media';
import { cn } from '@client/lib/utils';
import { RequireAction } from '@client/features/admin/RequireAction';
import { useBranchesAdmin, useReorder, type BranchRow } from '@client/features/content/api';
import { catalogKey, coverOf, useCatalogList, useDuplicateItem, useToggleItemActive, type CatalogListRow } from './api';
import { DeleteItemDialog } from './DeleteItemDialog';
import { PriceDisplay } from './PriceDisplay';

export function ServicesPage() {
  return (
    <RequireAction action="catalog.edit">
      <CatalogList kind="service" />
    </RequireAction>
  );
}

export function ProductsPage() {
  return (
    <RequireAction action="catalog.edit">
      <CatalogList kind="product" />
    </RequireAction>
  );
}

type StatusFilter = 'all' | 'active' | 'inactive';
const ALL = 'all';

/** ¿Se ofrece el ítem en la sede? Sin catálogo propio: siempre. Con catálogo propio: si está marcado. */
function availableIn(row: CatalogListRow, branch: BranchRow): boolean {
  if (!branch.own_catalog) return true;
  return row.branch_catalog_items.some((b) => b.branch_id === branch.id && b.is_active);
}

function CatalogList({ kind }: { kind: CatalogKind }) {
  const company = useCompany();
  const navigate = useNavigate();
  const list = useCatalogList(kind);
  const branches = useBranchesAdmin();
  const reorder = useReorder('catalog_items', catalogKey(company.id, kind));
  const toggle = useToggleItemActive();
  const duplicate = useDuplicateItem();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [branchId, setBranchId] = useState<string>(ALL);
  const [deleting, setDeleting] = useState<CatalogListRow | null>(null);
  const [now] = useState(() => new Date());
  const labels = KIND_LABELS[kind];

  const activeBranches = useMemo(() => (branches.data ?? []).filter((b) => b.is_active), [branches.data]);
  const branch = activeBranches.find((b) => b.id === branchId) ?? null;

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (list.data ?? []).filter(
      (r) =>
        (!q || r.name.toLowerCase().includes(q) || (r.reference ?? '').toLowerCase().includes(q)) &&
        (status === 'all' || r.is_active === (status === 'active')) &&
        (!branch || availableIn(r, branch)),
    );
  }, [list.data, search, status, branch]);

  if (list.isPending || branches.isPending) return <FullPageSpinner />;
  if (list.isError) throw list.error;
  if (branches.isError) throw branches.error;

  const filtered = search.trim() !== '' || status !== 'all' || branch !== null;
  const total = list.data.length;
  const NewIcon = kind === 'service' ? ScissorsIcon : PackageIcon;

  async function onDuplicate(row: CatalogListRow) {
    try {
      const id = await duplicate.mutateAsync(row.id);
      toast.success('Copia creada (inactiva). Revísala antes de activarla.');
      navigate(id);
    } catch (error) {
      toast.error(messageOf(error));
    }
  }

  return (
    <>
      <PageHeader
        title={labels.many}
        description={
          kind === 'service'
            ? 'Lo que tus clientes pueden reservar.'
            : 'Productos que vendes; puedes ofrecerlos dentro de una reserva.'
        }
        actions={
          <Button asChild>
            <Link to="nuevo">
              <PlusIcon aria-hidden /> Nuevo {labels.one}
            </Link>
          </Button>
        }
      />

      {total === 0 ? (
        <EmptyState
          icon={NewIcon}
          title={`Aún no tienes ${labels.many.toLowerCase()}`}
          description={
            kind === 'service'
              ? 'Crea tu primer servicio con su precio, duración y fotos.'
              : 'Crea productos para venderlos o añadirlos a una reserva.'
          }
          action={
            <Button asChild>
              <Link to="nuevo">
                <PlusIcon aria-hidden /> Nuevo {labels.one}
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <div className="relative sm:w-72">
              <SearchIcon
                className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                type="search"
                aria-label="Buscar por nombre o referencia"
                placeholder="Buscar por nombre o referencia"
                className="pl-8"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
              <SelectTrigger aria-label="Filtrar por estado" className="sm:w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="active">Activos</SelectItem>
                <SelectItem value="inactive">Inactivos</SelectItem>
              </SelectContent>
            </Select>
            {activeBranches.length > 1 && (
              <Select value={branchId} onValueChange={setBranchId}>
                <SelectTrigger aria-label="Filtrar por sede" className="sm:w-52">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Todas las sedes</SelectItem>
                  {activeBranches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <p className="text-sm text-muted-foreground sm:ml-auto" aria-live="polite">
              {filtered ? `${rows.length} de ${total}` : `${total} en total`}
            </p>
          </div>

          <SortableTable
            rows={rows}
            disabled={filtered || reorder.isPending}
            onReorder={(ids) => reorder.mutate(ids, { onError: (e) => toast.error(messageOf(e)) })}
            head={
              <>
                <TableHead className="w-10">
                  <span className="sr-only">Orden</span>
                </TableHead>
                <TableHead className="w-14">
                  <span className="sr-only">Foto</span>
                </TableHead>
                <TableHead>Nombre</TableHead>
                <TableHead>Precio{branch ? ` en ${branch.name}` : ''}</TableHead>
                {kind === 'service' && <TableHead className="hidden md:table-cell">Duración</TableHead>}
                {activeBranches.length > 1 && <TableHead className="hidden lg:table-cell">Sedes</TableHead>}
                <TableHead className="w-20">Activo</TableHead>
                <TableHead className="w-12">
                  <span className="sr-only">Acciones</span>
                </TableHead>
              </>
            }
            empty={<span>Ningún {labels.one} coincide con los filtros.</span>}
            colSpan={6 + (kind === 'service' ? 1 : 0) + (activeBranches.length > 1 ? 1 : 0)}
            renderRow={(row, handle) => {
              const override = branch?.own_catalog
                ? row.branch_catalog_items.find((b) => b.branch_id === branch.id)?.price_override
                : null;
              const price = priceAt(row, row.discounts, now, branch?.id ?? null, {
                override,
                currency: company.currency,
              });
              const cover = coverOf(row);
              const availableCount = activeBranches.filter((b) => availableIn(row, b)).length;
              return (
                <>
                  <TableCell>{handle}</TableCell>
                  <TableCell>
                    <div className="flex size-10 items-center justify-center overflow-hidden rounded-md border bg-muted">
                      {cover ? (
                        <img src={mediaUrl(cover, 'thumb') ?? ''} alt="" className="size-full object-cover" />
                      ) : (
                        <ImageIcon className="size-4 text-muted-foreground" aria-hidden />
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="max-w-64 whitespace-normal">
                    <Link to={row.id} className="font-medium hover:underline" data-testid="catalog-item-name">
                      {row.name}
                    </Link>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      {row.reference && <span>{row.reference}</span>}
                      {row.is_featured && (
                        <span className="inline-flex items-center gap-0.5">
                          <StarIcon className="size-3" aria-hidden /> Destacado
                        </span>
                      )}
                      {kind === 'product' && row.allow_in_booking && (
                        <Badge variant="outline" className="text-[10px]">
                          En reservas
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell data-testid="catalog-item-price">
                    <PriceDisplay price={price} />
                  </TableCell>
                  {kind === 'service' && (
                    <TableCell className="hidden md:table-cell">{formatDuration(row.duration_minutes)}</TableCell>
                  )}
                  {activeBranches.length > 1 && (
                    <TableCell className="hidden lg:table-cell">
                      {availableCount === activeBranches.length ? (
                        <span className="text-muted-foreground">Todas</span>
                      ) : (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-default underline decoration-dotted underline-offset-4">
                              {availableCount} de {activeBranches.length}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            {activeBranches
                              .filter((b) => availableIn(row, b))
                              .map((b) => b.name)
                              .join(', ') || 'Ninguna'}
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </TableCell>
                  )}
                  <TableCell>
                    <Switch
                      checked={row.is_active}
                      aria-label={`${row.name} activo`}
                      onCheckedChange={(active) =>
                        toggle.mutate(
                          { id: row.id, active },
                          {
                            onSuccess: () => toast.success(active ? 'Activado' : 'Inactivado'),
                            onError: (e) => toast.error(messageOf(e)),
                          },
                        )
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label={`Acciones de ${row.name}`}>
                          <MoreHorizontalIcon />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => navigate(row.id)}>
                          <PencilIcon aria-hidden /> Editar
                        </DropdownMenuItem>
                        <DropdownMenuItem disabled={duplicate.isPending} onSelect={() => void onDuplicate(row)}>
                          <CopyIcon aria-hidden /> Duplicar
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(row)}>
                          <Trash2Icon aria-hidden /> Eliminar
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </>
              );
            }}
          />
          {filtered && rows.length > 1 && (
            <p className="text-xs text-muted-foreground">Quita la búsqueda y los filtros para cambiar el orden.</p>
          )}
        </div>
      )}

      <DeleteItemDialog item={deleting} onOpenChange={(open) => !open && setDeleting(null)} />
    </>
  );
}

/** Tabla con filas reordenables (ratón, táctil y teclado), como SortableList. */
function SortableTable({
  rows,
  disabled,
  onReorder,
  head,
  renderRow,
  empty,
  colSpan,
}: {
  rows: CatalogListRow[];
  disabled: boolean;
  onReorder: (ids: string[]) => void;
  head: ReactNode;
  renderRow: (row: CatalogListRow, handle: ReactNode) => ReactNode;
  empty: ReactNode;
  colSpan: number;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = rows.findIndex((r) => r.id === active.id);
    const to = rows.findIndex((r) => r.id === over.id);
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(rows, from, to).map((r) => r.id));
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis]}
        onDragEnd={onDragEnd}
        accessibility={{
          screenReaderInstructions: {
            draggable: 'Pulsa Espacio para tomar la fila, flechas para moverla y Espacio para soltarla.',
          },
        }}
      >
        <Table>
          <TableHeader>
            <TableRow>{head}</TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={colSpan} className="h-24 text-center text-muted-foreground">
                  {empty}
                </TableCell>
              </TableRow>
            ) : (
              <SortableContext items={rows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
                {rows.map((row) => (
                  <SortableRow key={row.id} row={row} disabled={disabled} render={renderRow} />
                ))}
              </SortableContext>
            )}
          </TableBody>
        </Table>
      </DndContext>
    </div>
  );
}

function SortableRow({
  row,
  disabled,
  render,
}: {
  row: CatalogListRow;
  disabled: boolean;
  render: (row: CatalogListRow, handle: ReactNode) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: row.id,
    disabled,
  });
  const handle = (
    <button
      type="button"
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      aria-label={`Mover ${row.name}`}
      disabled={disabled}
      className="flex size-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-30"
    >
      <GripVerticalIcon className="size-4" aria-hidden />
    </button>
  );
  return (
    <TableRow
      ref={setNodeRef}
      data-testid="catalog-row"
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'relative bg-background',
        isDragging && 'z-10 opacity-80 shadow-lg',
        !row.is_active && 'opacity-70',
      )}
    >
      {render(row, handle)}
    </TableRow>
  );
}
