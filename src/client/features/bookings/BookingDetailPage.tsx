import { ArrowLeftIcon } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import { Button } from '@client/components/ui/button';
import { BookingDetail } from './BookingDetail';

/** `/admin/reservas/:id`: el mismo detalle del panel lateral, en página completa (enlace directo). */
export function Component() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link to="/admin/reservas">
          <ArrowLeftIcon aria-hidden /> Reservas
        </Link>
      </Button>
      <h1 className="sr-only">Reserva</h1>
      <BookingDetail key={id} id={id} onOpenBooking={(other) => void navigate(`/admin/reservas/${other}`)} />
    </div>
  );
}
