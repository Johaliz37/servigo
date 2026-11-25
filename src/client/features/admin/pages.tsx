import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@client/components/ui/card';
import { PageHeader } from '@client/components/common/PageHeader';
import { NewPasswordForm } from '@client/features/auth/forms';
import { useSession } from '@client/features/auth/session';

export function AccountPage() {
  const { session } = useSession();
  return (
    <>
      <PageHeader title="Mi cuenta" description={session?.user.email} />
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Cambiar contraseña</CardTitle>
          <CardDescription>La contraseña es la misma en todas las empresas donde tienes acceso.</CardDescription>
        </CardHeader>
        <CardContent>
          <NewPasswordForm onSuccess={() => toast.success('Contraseña actualizada')} />
        </CardContent>
      </Card>
    </>
  );
}
