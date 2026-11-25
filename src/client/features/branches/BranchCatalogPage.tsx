import { Link, useParams } from 'react-router';
import { ArrowLeftIcon, InfoIcon } from 'lucide-react';
import { toast } from 'sonner';
import { KIND_LABELS, type CatalogKind } from '@shared/catalog';
import { formatMoney } from '@shared/format';
import { Alert, AlertDescription } from '@client/components/ui/alert';
import { Badge } from '@client/components/ui/badge';
import { Button } from '@client/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@client/components/ui/card';
import { Input } from '@client/components/ui/input';
import { Switch } from '@client/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@client/components/ui/table';
import { NotFoundPage } from '@client/components/common/RouteError';
import { FullPageSpinner } from '@client/components/common/Spinner';
import { useCompany } from '@client/app/tenant-context';
import { messageOf } from '@client/lib/errors';
import { RequireAction } from '@client/features/admin/RequireAction';
import { useBranchesAdmin } from '@client/features/content/api';
import { useBranchCatalog, useSetBranchItems } from '@client/features/catalog/api';

export function Component() {
  return (
    <RequireAction action="catalog.edit">
      <BranchCatalog />
    </RequireAction>
  );
}

interface MatrixRow {
  id: string;
  kind: CatalogKind;
  name: string;
  reference: string | null;
  price: number;
  companyActive: boolean;
  available: boolean;
  override: number | null;
}

function BranchCatalog() {
  const { id = '' } = useParams();
  const branches = useBranchesAdmin();
  const catalog = useBranchCatalog(id);
  const set = useSetBranchItems(id);

  if (branches.isPending || catalog.isPending) return <FullPageSpinner />;
  if (branches.isError) throw branches.error;
  if (catalog.isError) throw catalog.error;
  const branch = branches.data.find((b) => b.id === id);
  if (!branch) return <NotFoundPage />;

  const byItem = new Map(catalog.data.rows.map((r) => [r.item_id, r]));
  const rows: MatrixRow[] = catalog.data.items.map((i) => ({
    id: i.id,
    kind: i.kind,
    name: i.name,
    reference: i.reference,
    price: i.price,
    companyActive: i.is_active,
    available: byItem.get(i.id)?.is_active ?? false,
    override: byItem.get(i.id)?.price_override ?? null,
  }));

  function update(changes: { item_id: string; is_active: boolean; price_override: number | null }[], ok: string) {
    set.mutate(changes, {
      onSuccess: () => toast.success(ok),
      onError: (e) => toast.error(messageOf(e)),
    });
  }

  return (
    <>
      <div className="space-y-1 pb-6">
        <Link
          to="/admin/sedes"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" aria-hidden /> Sedes
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Catálogo de {branch.name}</h1>
        <p className="text-sm text-muted-foreground">Qué se ofrece en esta sede y a qué precio.</p>
      </div>

      {!branch.own_catalog ? (
        <Alert className="max-w-2xl">
          <InfoIcon aria-hidden />
          <AlertDescription>
            Esta sede ofrece todo el catálogo activo de la empresa con los precios generales. Para elegir qué se ofrece
            aquí, edita la sede y activa «Catálogo propio».
          </AlertDescription>
        </Alert>
      ) : (
        <div className="max-w-4xl space-y-6">
          {(['service', 'product'] as const).map((kind) => (
            <KindMatrix
              key={kind}
              kind={kind}
              rows={rows.filter((r) => r.kind === kind)}
              pending={set.isPending}
              onChange={update}
            />
          ))}
        </div>
      )}
    </>
  );
}

function KindMatrix({
  kind,
  rows,
  pending,
  onChange,
}: {
  kind: CatalogKind;
  rows: MatrixRow[];
  pending: boolean;
  onChange: (changes: { item_id: string; is_active: boolean; price_override: number | null }[], ok: string) => void;
}) {
  const company = useCompany();
  const labels = KIND_LABELS[kind];
  const availableCount = rows.filter((r) => r.available).length;

  function bulk(active: boolean) {
    const changes = rows
      .filter((r) => r.available !== active)
      .map((r) => ({ item_id: r.id, is_active: active, price_override: r.override }));
    if (changes.length === 0) return;
    onChange(changes, active ? `${labels.many}: todos disponibles` : `${labels.many}: ninguno disponible`);
  }

  function saveOverride(row: MatrixRow, raw: string) {
    const text = raw.trim().replace(',', '.');
    const value = text === '' ? null : Number(text);
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      toast.error('Escribe un precio válido o déjalo vacío para usar el general.');
      return;
    }
    if (value === row.override) return;
    onChange([{ item_id: row.id, is_active: row.available, price_override: value }], 'Precio de la sede guardado');
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <CardTitle>{labels.many}</CardTitle>
          <CardDescription>
            {availableCount} de {rows.length} disponibles
          </CardDescription>
        </div>
        {rows.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={pending || availableCount === rows.length}
              onClick={() => bulk(true)}
            >
              Activar todos
            </Button>
            <Button size="sm" variant="outline" disabled={pending || availableCount === 0} onClick={() => bulk(false)}>
              Desactivar todos
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aún no hay {labels.many.toLowerCase()} en el catálogo.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead className="hidden sm:table-cell">Precio general</TableHead>
                  <TableHead>Disponible</TableHead>
                  <TableHead>Precio en la sede</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id} data-testid="branch-catalog-row">
                    <TableCell className="whitespace-normal">
                      <p className="font-medium">{row.name}</p>
                      <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
                        {row.reference && <span>{row.reference}</span>}
                        {!row.companyActive && <Badge variant="outline">Inactivo en la empresa</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="hidden tabular-nums sm:table-cell">
                      {formatMoney(row.price, company.currency, company.locale)}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={row.available}
                        disabled={pending}
                        aria-label={`${row.name} disponible en la sede`}
                        onCheckedChange={(active) =>
                          onChange(
                            [{ item_id: row.id, is_active: active, price_override: row.override }],
                            active ? 'Disponible en la sede' : 'Ya no se ofrece en la sede',
                          )
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        // Se vuelve a montar cuando cambia el valor guardado.
                        key={String(row.override)}
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="any"
                        className="w-32"
                        aria-label={`Precio de ${row.name} en la sede`}
                        placeholder="General"
                        defaultValue={row.override ?? ''}
                        disabled={pending}
                        onBlur={(e) => saveOverride(row, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.currentTarget.blur();
                        }}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
