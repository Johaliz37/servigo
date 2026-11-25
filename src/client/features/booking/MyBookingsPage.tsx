import { useState } from 'react';
import { ChevronRightIcon } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { formatBookingDate, formatCode, STATUS_LABELS, type BookingSummary } from '@shared/booking';
import { Badge } from '@client/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@client/components/ui/tabs';
import { useCompany } from '@client/app/tenant-context';
import { useDocumentTitle } from '@client/features/public/hooks';
import { saveToken } from './api';
import { LookupForm } from './LookupForm';

function Results({ results }: { results: BookingSummary[] }) {
  if (!results.length) return null;
  return (
    <section aria-labelledby="resultados" className="space-y-3">
      <h2 id="resultados" className="font-semibold">
        {results.length === 1 ? '1 reserva' : `${results.length} reservas`}
      </h2>
      <ul className="divide-y rounded-xl border">
        {results.map((r) => (
          <li key={r.code}>
            <Link
              to={`/reserva/${r.code}?t=${encodeURIComponent(r.token)}`}
              className="flex items-center gap-3 p-4 hover:bg-accent/50 focus-visible:bg-accent focus-visible:outline-none"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{r.service_name}</span>
                  <Badge variant="secondary">{STATUS_LABELS[r.status]}</Badge>
                </p>
                <p className="text-sm first-letter:uppercase">{formatBookingDate(r.starts_at, r.timezone)}</p>
                <p className="text-sm text-muted-foreground">
                  {r.branch_name} · {r.customer_name} · <span className="font-mono">{formatCode(r.code)}</span>
                </p>
              </div>
              <ChevronRightIcon aria-hidden className="size-5 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** `/mis-reservas` (fase 10 §4): por código (con contacto) o por contacto. */
export function Component() {
  const company = useCompany();
  const navigate = useNavigate();
  const [results, setResults] = useState<BookingSummary[]>([]);
  useDocumentTitle(`Mis reservas · ${company.name}`);

  return (
    <div className="mx-auto max-w-xl space-y-6 px-4 py-10">
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">Mis reservas</h1>
        <p className="text-muted-foreground">Consulta tus reservas sin crear una cuenta.</p>
      </div>
      <Tabs defaultValue="codigo" onValueChange={() => setResults([])}>
        <TabsList className="w-full">
          <TabsTrigger value="codigo">Por código</TabsTrigger>
          <TabsTrigger value="contacto">Por teléfono o correo</TabsTrigger>
        </TabsList>
        <TabsContent value="codigo" className="pt-4">
          <LookupForm
            mode="code"
            onResults={(list) => {
              const found = list[0];
              if (!found) return;
              saveToken(company.id, found.code, found.token);
              void navigate(`/reserva/${found.code}?t=${encodeURIComponent(found.token)}`);
            }}
          />
        </TabsContent>
        <TabsContent value="contacto" className="space-y-6 pt-4">
          <LookupForm mode="contact" onResults={setResults} />
          <Results results={results} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
