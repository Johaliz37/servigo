import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch, type Control } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { assignableRoles, ROLE_LABELS, type MemberRole } from '@shared/permissions';
import { inviteMemberSchema } from '@shared/schemas';
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
import { messageOf } from '@client/lib/errors';
import { useMembership } from '@client/features/auth/membership';
import { useSelectedBranch } from '@client/features/admin/branch-context';
import { EMAIL_SENT_MESSAGES, useInviteMember, useUpdateMember, type MemberRow } from './api';

type InviteValues = z.input<typeof inviteMemberSchema>;

/** Casillas de sedes. Ninguna marcada = todas las sedes. */
function BranchPicker({ value, onChange }: { value: string[] | null; onChange: (v: string[] | null) => void }) {
  const { branches } = useSelectedBranch();
  const selected = value ?? [];
  return (
    <div className="space-y-2">
      {branches.map((b) => {
        const id = `branch-${b.id}`;
        return (
          <div key={b.id} className="flex items-center gap-2">
            <Checkbox
              id={id}
              checked={selected.includes(b.id)}
              onCheckedChange={(checked) => {
                const next = checked ? [...selected, b.id] : selected.filter((x) => x !== b.id);
                onChange(next.length === 0 ? null : next);
              }}
            />
            <Label htmlFor={id} className="font-normal">
              {b.name}
            </Label>
          </div>
        );
      })}
    </div>
  );
}

function RoleSelect({
  value,
  onChange,
  roles,
}: {
  value: MemberRole;
  onChange: (r: MemberRole) => void;
  roles: MemberRole[];
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as MemberRole)}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {roles.map((r) => (
          <SelectItem key={r} value={r}>
            {ROLE_LABELS[r]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const ROLE_HELP: Record<MemberRole, string> = {
  owner: 'Todo, incluidos los demás miembros.',
  admin: 'Todo salvo gestionar propietarios y administradores.',
  staff: 'Reservas y calendario de sus sedes; catálogo en solo lectura.',
};

function StaffBranchesField({ control }: { control: Control<InviteValues> }) {
  const role = useWatch({ control, name: 'role' });
  if (role !== 'staff') return null;
  return (
    <FormField
      control={control}
      name="branchIds"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Sedes</FormLabel>
          <FormDescription>Sin marcar ninguna, tendrá acceso a todas.</FormDescription>
          <BranchPicker value={field.value ?? null} onChange={field.onChange} />
        </FormItem>
      )}
    />
  );
}

export function InviteMemberDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { role } = useMembership();
  const roles = assignableRoles(role);
  const invite = useInviteMember();
  const form = useForm<InviteValues, unknown, z.output<typeof inviteMemberSchema>>({
    resolver: zodResolver(inviteMemberSchema),
    defaultValues: { email: '', role: roles.includes('admin') ? 'admin' : 'staff', branchIds: null },
  });

  async function submit(values: z.output<typeof inviteMemberSchema>) {
    try {
      const result = await invite.mutateAsync(values);
      if (result.emailSent === 'none')
        toast.warning(`Invitación creada para ${result.email}. ${EMAIL_SENT_MESSAGES.none}`);
      else toast.success(`Invitación enviada a ${result.email}. ${EMAIL_SENT_MESSAGES[result.emailSent]}`);
      form.reset();
      onOpenChange(false);
    } catch (error) {
      form.setError('root', { message: messageOf(error) });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invitar miembro</DialogTitle>
          <DialogDescription>
            Recibirá un correo para unirse a la empresa. La invitación vence en 7 días.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form id="invite-member" onSubmit={form.handleSubmit(submit)} className="space-y-4" noValidate>
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Correo</FormLabel>
                  <FormControl>
                    <Input type="email" autoComplete="off" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="role"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Rol</FormLabel>
                  <RoleSelect value={field.value} onChange={field.onChange} roles={roles} />
                  <FormDescription>{ROLE_HELP[field.value]}</FormDescription>
                </FormItem>
              )}
            />
            <StaffBranchesField control={form.control} />
            {form.formState.errors.root && (
              <p role="alert" className="text-sm text-destructive">
                {form.formState.errors.root.message}
              </p>
            )}
          </form>
        </Form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" form="invite-member" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? 'Enviando…' : 'Enviar invitación'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EditMemberDialog({
  member,
  onOpenChange,
}: {
  member: MemberRow | null;
  onOpenChange: (o: boolean) => void;
}) {
  return (
    <Dialog open={!!member} onOpenChange={onOpenChange}>
      <DialogContent>
        {member && <EditMemberForm key={member.id} member={member} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function EditMemberForm({ member, onDone }: { member: MemberRow; onDone: () => void }) {
  const { role: myRole } = useMembership();
  const roles = assignableRoles(myRole);
  const update = useUpdateMember();
  const [role, setRole] = useState<MemberRole>(member.role);
  const [branchIds, setBranchIds] = useState<string[] | null>(member.branchIds);

  async function save() {
    try {
      await update.mutateAsync({ id: member.id, role, branchIds });
      toast.success('Miembro actualizado');
      onDone();
    } catch (error) {
      toast.error(messageOf(error));
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Editar miembro</DialogTitle>
        <DialogDescription>{member.email}</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label>Rol</Label>
          <RoleSelect value={role} onChange={setRole} roles={roles} />
          <p className="text-sm text-muted-foreground">{ROLE_HELP[role]}</p>
        </div>
        {role === 'staff' && (
          <div className="space-y-2">
            <Label>Sedes</Label>
            <p className="text-sm text-muted-foreground">Sin marcar ninguna, tendrá acceso a todas.</p>
            <BranchPicker value={branchIds} onChange={setBranchIds} />
          </div>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancelar
        </Button>
        <Button disabled={update.isPending} onClick={() => void save()}>
          {update.isPending ? 'Guardando…' : 'Guardar'}
        </Button>
      </DialogFooter>
    </>
  );
}
