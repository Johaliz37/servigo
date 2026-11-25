import { Link } from 'react-router';
import { ExternalLinkIcon } from 'lucide-react';
import { FIELD_TYPE_INFO, fieldsForService } from '@shared/booking-fields';
import { Badge } from '@client/components/ui/badge';
import { Button } from '@client/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@client/components/ui/card';
import { Skeleton } from '@client/components/ui/skeleton';
import { useBookingFields } from './api';
import { FIELD_ICONS } from './field-icons';

/** Resumen de la información adicional de un servicio (pestaña de su ficha) con atajo al constructor. */
export function ServiceFieldsCard({ serviceId }: { serviceId: string }) {
  const fields = useBookingFields();
  const all = fields.data ?? [];
  const asked = fieldsForService(all, serviceId);
  const own = all.filter((f) => f.service_id === serviceId);
  const generalCount = asked.length - own.filter((f) => f.is_active).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Información adicional</CardTitle>
        <CardDescription>
          Al reservar este servicio se piden {generalCount} campos generales y {own.length} propios.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {fields.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : fields.isError ? (
          <p className="text-sm text-destructive">No se pudieron cargar los campos.</p>
        ) : asked.length === 0 ? (
          <p className="text-sm text-muted-foreground">No se pide información adicional.</p>
        ) : (
          <ol className="space-y-2">
            {asked.map((f) => {
              const Icon = FIELD_ICONS[f.type];
              return (
                <li key={f.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <Icon className="size-4 text-muted-foreground" aria-hidden />
                  <span className="font-medium">{f.label}</span>
                  <span className="text-muted-foreground">· {FIELD_TYPE_INFO[f.type].label}</span>
                  {f.service_id === null ? (
                    <Badge variant="secondary">General</Badge>
                  ) : (
                    <Badge variant="outline">De este servicio</Badge>
                  )}
                  {f.required && <Badge variant="outline">Obligatorio</Badge>}
                </li>
              );
            })}
          </ol>
        )}
        <Button variant="outline" asChild>
          <Link to={`/admin/formularios?servicio=${serviceId}`}>
            <ExternalLinkIcon aria-hidden /> Editar campos de este servicio
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
