import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { MailIcon, MoreHorizontalIcon, PencilIcon, SendIcon, TrashIcon, UserPlusIcon } from 'lucide-react';
import { Navigate } from 'react-router';
import { toast } from 'sonner';
import { assignableRoles, ROLE_LABELS, type MemberRole } from '@shared/permissions';
import { Badge } from '@client/components/ui/badge';
import { Button } from '@client/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@client/components/ui/dropdown-menu';
import { ConfirmDialog } from '@client/components/common/ConfirmDialog';
import { DataTable } from '@client/components/common/DataTable';
import { DateTimeInSede } from '@client/components/common/DateTimeInSede';
import { PageHeader } from '@client/components/common/PageHeader';
import { useCompany } from '@client/app/tenant-context';
import { messageOf } from '@client/lib/errors';
import { useMembership } from '@client/features/auth/membership';
import { useSession } from '@client/features/auth/session';
import { useSelectedBranch } from '@client/features/admin/branch-context';
import {
  EMAIL_SENT_MESSAGES,
  useInvitations,
  useMembers,
  useRemoveMember,
  useResendInvitation,
  useRevokeInvitation,
  type InvitationRow,
  type MemberRow,
} from './api';
import { EditMemberDialog, InviteMemberDialog } from './MemberDialogs';

function RoleBadge({ role }: { role: MemberRole }) {
  return (
    <Badge variant={role === 'owner' ? 'default' : role === 'admin' ? 'secondary' : 'outline'}>
      {ROLE_LABELS[role]}
    </Badge>
  );
}

function useBranchNames() {
  const { branches } = useSelectedBranch();
  return (ids: string[] | null) =>
    ids === null ? 'Todas' : ids.map((id) => branches.find((b) => b.id === id)?.name ?? '—').join(', ');
}

export function Component() {
  const company = useCompany();
  const { role: myRole, can } = useMembership();
  const { session } = useSession();
  const members = useMembers();
  const invitations = useInvitations();
  const removeMember = useRemoveMember();
  const resend = useResendInvitation();
  const revoke = useRevokeInvitation();
  const branchNames = useBranchNames();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [editing, setEditing] = useState<MemberRow | null>(null);
  const [removing, setRemoving] = useState<MemberRow | null>(null);
  const [revoking, setRevoking] = useState<InvitationRow | null>(null);

  const manageable = assignableRoles(myRole);
  const canManage = (role: MemberRole) => manageable.includes(role);

  const memberColumns = useMemo<ColumnDef<MemberRow>[]>(
    () => [
      {
        accessorKey: 'email',
        header: 'Correo',
        cell: ({ row }) => (
          <span className="font-medium">
            {row.original.email}
            {row.original.userId === session?.user.id && <span className="text-muted-foreground"> (tú)</span>}
          </span>
        ),
      },
      { accessorKey: 'role', header: 'Rol', cell: ({ row }) => <RoleBadge role={row.original.role} /> },
      {
        id: 'branches',
        header: 'Sedes',
        enableSorting: false,
        cell: ({ row }) => (row.original.role === 'staff' ? branchNames(row.original.branchIds) : 'Todas'),
      },
      {
        accessorKey: 'lastSignInAt',
        header: 'Último acceso',
        cell: ({ row }) =>
          row.original.lastSignInAt ? (
            <DateTimeInSede value={row.original.lastSignInAt} timeZone={company.timezone} pattern="d MMM yyyy" />
          ) : (
            <span className="text-muted-foreground">Nunca</span>
          ),
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">Acciones</span>,
        enableSorting: false,
        cell: ({ row }) => {
          const m = row.original;
          const isMe = m.userId === session?.user.id;
          if (!canManage(m.role)) return null;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={`Acciones para ${m.email}`}>
                  <MoreHorizontalIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setEditing(m)}>
                  <PencilIcon aria-hidden /> Editar rol y sedes
                </DropdownMenuItem>
                {!isMe && (
                  <DropdownMenuItem variant="destructive" onSelect={() => setRemoving(m)}>
                    <TrashIcon aria-hidden /> Quitar acceso
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- canManage/branchNames dependen de myRole y sedes
    [session?.user.id, company.timezone, myRole, branchNames],
  );

  const invitationColumns = useMemo<ColumnDef<InvitationRow>[]>(
    () => [
      {
        accessorKey: 'email',
        header: 'Correo',
        cell: ({ row }) => <span className="font-medium">{row.original.email}</span>,
      },
      { accessorKey: 'role', header: 'Rol', cell: ({ row }) => <RoleBadge role={row.original.role} /> },
      {
        accessorKey: 'expiresAt',
        header: 'Vence',
        cell: ({ row }) => {
          const expired = new Date(row.original.expiresAt) < new Date();
          return expired ? (
            <Badge variant="destructive">Vencida</Badge>
          ) : (
            <DateTimeInSede value={row.original.expiresAt} timeZone={company.timezone} pattern="d MMM yyyy" />
          );
        },
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">Acciones</span>,
        enableSorting: false,
        cell: ({ row }) => {
          const inv = row.original;
          if (!canManage(inv.role)) return null;
          return (
            <div className="flex justify-end gap-1">
              <Button
                variant="ghost"
                size="sm"
                disabled={resend.isPending}
                onClick={() =>
                  resend.mutate(inv.id, {
                    onSuccess: (r) =>
                      r.emailSent === 'none'
                        ? toast.warning(EMAIL_SENT_MESSAGES.none)
                        : toast.success(`Invitación reenviada a ${r.email}`),
                    onError: (e) => toast.error(messageOf(e)),
                  })
                }
              >
                <SendIcon aria-hidden /> Reenviar
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setRevoking(inv)}>
                <TrashIcon aria-hidden /> Revocar
              </Button>
            </div>
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- canManage depende de myRole
    [company.timezone, myRole, resend.isPending],
  );

  if (!can('members.view')) return <Navigate to="/admin" replace />;

  return (
    <>
      <PageHeader
        title="Miembros"
        description={`Personas con acceso al panel de ${company.name}.`}
        actions={
          manageable.length > 0 && (
            <Button onClick={() => setInviteOpen(true)}>
              <UserPlusIcon aria-hidden /> Invitar
            </Button>
          )
        }
      />

      <div className="space-y-8">
        <section className="space-y-3">
          <DataTable
            columns={memberColumns}
            data={members.data ?? []}
            loading={members.isPending}
            empty={members.isError ? messageOf(members.error) : 'Aún no hay miembros.'}
            getRowId={(m) => m.id}
          />
        </section>

        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <MailIcon className="size-4" aria-hidden /> Invitaciones pendientes
          </h2>
          <DataTable
            columns={invitationColumns}
            data={invitations.data ?? []}
            loading={invitations.isPending}
            empty={invitations.isError ? messageOf(invitations.error) : 'No hay invitaciones pendientes.'}
            getRowId={(i) => i.id}
          />
        </section>
      </div>

      <InviteMemberDialog open={inviteOpen} onOpenChange={setInviteOpen} />
      <EditMemberDialog member={editing} onOpenChange={(o) => !o && setEditing(null)} />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="¿Quitar acceso?"
        description={`${removing?.email ?? ''} ya no podrá entrar al panel de ${company.name}. Su cuenta no se borra.`}
        confirmLabel="Quitar acceso"
        destructive
        onConfirm={async () => {
          if (!removing) return;
          await removeMember.mutateAsync(removing.id);
          toast.success('Acceso retirado');
        }}
      />
      <ConfirmDialog
        open={!!revoking}
        onOpenChange={(o) => !o && setRevoking(null)}
        title="¿Revocar invitación?"
        description={`El enlace enviado a ${revoking?.email ?? ''} dejará de funcionar.`}
        confirmLabel="Revocar"
        destructive
        onConfirm={async () => {
          if (!revoking) return;
          await revoke.mutateAsync(revoking.id);
          toast.success('Invitación revocada');
        }}
      />
    </>
  );
}
