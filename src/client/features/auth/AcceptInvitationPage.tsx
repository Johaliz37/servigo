import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import { ROLE_LABELS } from '@shared/permissions';
import { Button } from '@client/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@client/components/ui/card';
import { FullPageSpinner } from '@client/components/common/Spinner';
import { useCompany } from '@client/app/tenant-context';
import { messageOf } from '@client/lib/errors';
import { initialAuthError } from '@client/lib/initial-url';
import { supabase } from '@client/lib/supabase';
import { LoginForm, NewPasswordForm } from './forms';
import { needsPassword, signOut, useSession } from './session';

const invitationSchema = z.object({
  company_name: z.string(),
  company_slug: z.string(),
  email: z.string(),
  role: z.enum(['owner', 'admin', 'staff']),
  expired: z.boolean(),
  accepted: z.boolean(),
});

function Message({ title, children, footer }: { title: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{children}</CardDescription>
      </CardHeader>
      {footer && <CardFooter className="flex flex-wrap gap-2">{footer}</CardFooter>}
    </Card>
  );
}

/**
 * Destino del correo de invitación (`/admin/aceptar-invitacion?token=`).
 * Usuario nuevo: llega con sesión (hash del enlace) → crea contraseña → acepta.
 * Usuario existente: enlace mágico o login con su contraseña → acepta.
 */
export function Component() {
  const company = useCompany();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const validToken = z.uuid().safeParse(token).success;
  const { status, session } = useSession();
  const [accepting, setAccepting] = useState(false);

  const invitation = useQuery({
    queryKey: ['invitation', token],
    enabled: validToken,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_invitation', { p_token: token });
      if (error) throw error;
      return data === null ? null : invitationSchema.parse(data);
    },
  });

  if (!validToken) return <Message title="Enlace incompleto">Abre el enlace completo que llegó a tu correo.</Message>;
  if (status === 'loading' || invitation.isPending) return <FullPageSpinner />;
  if (invitation.isError)
    return <Message title="No pudimos cargar la invitación">{messageOf(invitation.error)}</Message>;

  const inv = invitation.data;
  const toAdmin = (
    <Button asChild>
      <Link to="/admin">Ir al panel</Link>
    </Button>
  );

  if (!inv || inv.company_slug !== company.slug) {
    return <Message title="Invitación no válida">La invitación no existe o fue revocada.</Message>;
  }
  if (inv.accepted) {
    return (
      <Message title="Invitación ya aceptada" footer={toAdmin}>
        Esta invitación ya se usó. Entra con tu correo y contraseña.
      </Message>
    );
  }
  if (inv.expired) {
    return (
      <Message title="Invitación vencida">
        Pide a {inv.company_name} que te la reenvíe desde la sección Miembros.
      </Message>
    );
  }

  const header = (
    <CardHeader>
      <CardTitle>Únete a {inv.company_name}</CardTitle>
      <CardDescription>
        Te invitaron como <strong>{ROLE_LABELS[inv.role].toLowerCase()}</strong> con el correo {inv.email}.
      </CardDescription>
    </CardHeader>
  );

  if (!session) {
    return (
      <Card>
        {header}
        <CardContent className="space-y-4">
          {initialAuthError && (
            <p role="alert" className="text-sm text-destructive">
              El enlace del correo venció o ya se usó. Si ya tienes contraseña, entra aquí; si no, usa «¿La olvidaste?».
            </p>
          )}
          <LoginForm area="/admin" defaultEmail={inv.email} onSuccess={() => undefined} />
        </CardContent>
      </Card>
    );
  }

  if (session.user.email?.toLowerCase() !== inv.email.toLowerCase()) {
    return (
      <Message
        title="Esta invitación es para otra cuenta"
        footer={
          <Button variant="outline" onClick={() => void signOut()}>
            Cerrar sesión
          </Button>
        }
      >
        Entraste como {session.user.email}, pero la invitación es para {inv.email}. Cierra sesión y entra con ese
        correo.
      </Message>
    );
  }

  async function accept() {
    setAccepting(true);
    const { error } = await supabase.rpc('accept_invitation', { p_token: token });
    setAccepting(false);
    if (error) {
      toast.error(messageOf(error));
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ['membership'] });
    toast.success(`Bienvenido a ${inv?.company_name ?? 'la empresa'}`);
    void navigate('/admin', { replace: true });
  }

  return (
    <Card>
      {header}
      <CardContent>
        {needsPassword(session) ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Crea tu contraseña para entrar las próximas veces.</p>
            <NewPasswordForm submitLabel="Crear contraseña y aceptar" onSuccess={() => void accept()} />
          </div>
        ) : (
          <Button className="w-full" disabled={accepting} onClick={() => void accept()}>
            {accepting ? 'Aceptando…' : 'Aceptar invitación'}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
