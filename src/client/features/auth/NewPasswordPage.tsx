import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@client/components/ui/card';
import { FullPageSpinner } from '@client/components/common/Spinner';
import { initialAuthError } from '@client/lib/initial-url';
import { useAuthArea } from './AuthLayout';
import { NewPasswordForm } from './forms';
import { useSession } from './session';

/** Destino del enlace de recuperación: supabase-js crea la sesión desde el hash de la URL. */
export function Component() {
  const area = useAuthArea();
  const navigate = useNavigate();
  const { status, session } = useSession();

  if (status === 'loading') return <FullPageSpinner />;

  if (!session) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Enlace no válido</CardTitle>
          <CardDescription>
            {initialAuthError?.code === 'otp_expired'
              ? 'El enlace venció o ya se usó.'
              : 'Abre el enlace del correo de recuperación en este mismo navegador.'}{' '}
            Pide uno nuevo.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Link to={`${area}/recuperar`} className="text-sm underline-offset-4 hover:underline">
            Pedir otro enlace
          </Link>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Crea tu contraseña nueva</CardTitle>
        <CardDescription>Para {session.user.email}. Usa al menos 8 caracteres.</CardDescription>
      </CardHeader>
      <CardContent>
        <NewPasswordForm
          onSuccess={() => {
            toast.success('Contraseña actualizada');
            void navigate(area, { replace: true });
          }}
        />
      </CardContent>
    </Card>
  );
}
