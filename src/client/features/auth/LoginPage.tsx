import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@client/components/ui/card';
import { FullPageSpinner } from '@client/components/common/Spinner';
import { useAuthArea } from './AuthLayout';
import { LoginForm } from './forms';
import { safeNext, useSession } from './session';

export function Component() {
  const area = useAuthArea();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'), area);
  const { status, session } = useSession();

  if (status === 'loading') return <FullPageSpinner />;
  // Ya hay sesión: el guard del área decide si tiene acceso.
  if (session) return <Navigate to={next} replace />;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Iniciar sesión</CardTitle>
        <CardDescription>
          {area === '/console' ? 'Acceso para operadores de Servigo.' : 'Entra al panel de administración.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <LoginForm area={area} onSuccess={() => void navigate(next, { replace: true })} />
      </CardContent>
    </Card>
  );
}
