import { useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import {
  ExternalLinkIcon,
  MoreHorizontalIcon,
  PauseCircleIcon,
  PlayCircleIcon,
  PlusIcon,
  SendIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { companyOrigin } from '@shared/tenant';
import { Badge } from '@client/components/ui/badge';
import { Button } from '@client/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@client/components/ui/dropdown-menu';
import { ConfirmDialog } from '@client/components/common/ConfirmDialog';
import { DataTable } from '@client/components/common/DataTable';
import { DateTimeInSede } from '@client/components/common/DateTimeInSede';
import { PageHeader } from '@client/components/common/PageHeader';
import { messageOf } from '@client/lib/errors';
import { ROOT_DOMAIN } from '@client/lib/platform';
import { useConsoleCompanies, useResendOwnerInvite, useSetCompanyStatus, type ConsoleCompany } from './api';
import { CreateCompanyDialog } from './CreateCompanyDialog';
const urlOf = (slug: string) => companyOrigin(window.location.href, ROOT_DOMAIN, slug);
const TZ = 'America/Bogota';

export function Component() {
  const companies = useConsoleCompanies();
  const setStatus = useSetCompanyStatus();
  const resend = useResendOwnerInvite();
  const [creating, setCreating] = useState(false);
  const [toggling, setToggling] = useState<ConsoleCompany | null>(null);

  const columns: ColumnDef<ConsoleCompany>[] = [
    {
      accessorKey: 'name',
      header: 'Empresa',
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span className="font-medium">{row.original.name}</span>
          <a
            href={urlOf(row.original.slug)}
            target="_blank"
            rel="noopener"
            className="text-xs text-muted-foreground underline-offset-4 hover:underline"
          >
            {row.original.slug}.{ROOT_DOMAIN}
          </a>
        </div>
      ),
    },
    {
      accessorKey: 'status',
      header: 'Estado',
      cell: ({ row }) =>
        row.original.status === 'active' ? (
          <Badge variant="secondary">Activa</Badge>
        ) : (
          <Badge variant="destructive">Suspendida</Badge>
        ),
    },
    {
      accessorKey: 'branchesCount',
      header: 'Sedes',
      cell: ({ row }) => <span className="tabular-nums">{row.original.branchesCount}</span>,
    },
    {
      accessorKey: 'bookingsThisMonth',
      header: 'Reservas del mes',
      cell: ({ row }) => <span className="tabular-nums">{row.original.bookingsThisMonth}</span>,
    },
    {
      accessorKey: 'createdAt',
      header: 'Creada',
      cell: ({ row }) => <DateTimeInSede value={row.original.createdAt} timeZone={TZ} pattern="d MMM yyyy" />,
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">Acciones</span>,
      enableSorting: false,
      cell: ({ row }) => {
        const c = row.original;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={`Acciones para ${c.name}`}>
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <a href={urlOf(c.slug)} target="_blank" rel="noopener">
                  <ExternalLinkIcon aria-hidden /> Abrir sitio
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href={`${urlOf(c.slug)}/admin`} target="_blank" rel="noopener">
                  <ExternalLinkIcon aria-hidden /> Abrir administración
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() =>
                  resend.mutate(c.id, {
                    onSuccess: (r) =>
                      r.emailSent === 'none'
                        ? toast.warning('No se pudo enviar el correo. Intenta en unos minutos.')
                        : toast.success(`Invitación reenviada a ${r.email}`),
                    onError: (e) => toast.error(messageOf(e)),
                  })
                }
              >
                <SendIcon aria-hidden /> Reenviar invitación al owner
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant={c.status === 'active' ? 'destructive' : 'default'}
                onSelect={() => setToggling(c)}
              >
                {c.status === 'active' ? (
                  <>
                    <PauseCircleIcon aria-hidden /> Suspender
                  </>
                ) : (
                  <>
                    <PlayCircleIcon aria-hidden /> Reactivar
                  </>
                )}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  const suspending = toggling?.status === 'active';

  return (
    <>
      <PageHeader
        title="Empresas"
        description="Clientes de Servigo. Cada empresa tiene su sitio en su propio subdominio."
        actions={
          <Button onClick={() => setCreating(true)}>
            <PlusIcon aria-hidden /> Nueva empresa
          </Button>
        }
      />
      <DataTable
        columns={columns}
        data={companies.data ?? []}
        loading={companies.isPending}
        empty={companies.isError ? messageOf(companies.error) : 'Aún no hay empresas.'}
        getRowId={(c) => c.id}
      />
      <CreateCompanyDialog open={creating} onOpenChange={setCreating} />
      <ConfirmDialog
        open={!!toggling}
        onOpenChange={(o) => !o && setToggling(null)}
        title={suspending ? `¿Suspender ${toggling?.name ?? ''}?` : `¿Reactivar ${toggling?.name ?? ''}?`}
        description={
          suspending
            ? 'Su sitio público y su panel mostrarán «Sitio temporalmente no disponible». Los datos no se borran.'
            : 'El sitio y el panel vuelven a estar disponibles.'
        }
        confirmLabel={suspending ? 'Suspender' : 'Reactivar'}
        destructive={suspending}
        onConfirm={async () => {
          if (!toggling) return;
          await setStatus.mutateAsync({ id: toggling.id, status: suspending ? 'suspended' : 'active' });
          toast.success(suspending ? 'Empresa suspendida' : 'Empresa reactivada');
        }}
      />
    </>
  );
}
