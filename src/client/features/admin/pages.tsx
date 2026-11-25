import { ConstructionIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@client/components/ui/card';
import { EmptyState } from '@client/components/common/EmptyState';
import { PageHeader } from '@client/components/common/PageHeader';
import { useCompany } from '@client/app/tenant-context';
import { NewPasswordForm } from '@client/features/auth/forms';
import { useSession } from '@client/features/auth/session';
import { useSelectedBranch } from './branch-context';

export function DashboardPage() {
  const company = useCompany();
  const { session } = useSession();
  const { selected } = useSelectedBranch();
  return (
    <>
      <PageHeader
        title={`Hola, ${session?.user.email?.split('@')[0] ?? ''}`}
        description={`Panel de ${company.name}${selected ? ` · ${selected.name}` : ' · todas las sedes'}`}
      />
      <EmptyState
        icon={ConstructionIcon}
        title="El dashboard llega en la fase 12"
        description="Aquí verás reservas del día, ingresos y ocupación por sede."
      />
    </>
  );
}

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
