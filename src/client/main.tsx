import '@client/lib/initial-url'; // primero: captura el hash antes que supabase-js
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { applyBrand } from './lib/brand';
import { loadTenant } from './lib/tenant';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('No se encontró #root');

void loadTenant().then((tenant) => {
  if (!tenant) {
    root.innerHTML =
      '<main style="padding:2rem;text-align:center;font-family:system-ui"><h1>Sitio no disponible</h1><p>Recarga la página en unos minutos.</p></main>';
    return;
  }
  if (tenant.type === 'company') applyBrand(tenant.company.primaryColor, tenant.company.secondaryColor);

  createRoot(root).render(
    <StrictMode>
      <App tenant={tenant} />
    </StrictMode>,
  );
});
