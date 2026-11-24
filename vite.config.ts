import { fileURLToPath, URL } from 'node:url';
import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';
import { defineConfig } from 'vite';

const alias = {
  '@client': fileURLToPath(new URL('./src/client', import.meta.url)),
  '@worker': fileURLToPath(new URL('./src/worker', import.meta.url)),
  '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
};

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
    cloudflare(),
    // `pnpm analyze` → dist/stats.html (verifica que el bundle público no cargue admin).
    mode === 'analyze' && visualizer({ filename: 'dist/stats.html', gzipSize: true, template: 'treemap' }),
  ],
  resolve: { alias },
  // Dependencias de los chunks lazy (admin, consola, auth): pre-optimizarlas evita que Vite
  // las descubra al navegar y recargue la página en desarrollo.
  optimizeDeps: {
    include: [
      '@supabase/supabase-js',
      'react-hook-form',
      '@hookform/resolvers/zod',
      'zod',
      '@tanstack/react-table',
      '@tanstack/react-query',
      'radix-ui',
      'sonner',
      'date-fns',
      'date-fns/locale/es',
      '@date-fns/tz',
      'lucide-react',
      '@dnd-kit/core',
      '@dnd-kit/sortable',
      '@dnd-kit/utilities',
      'react-easy-crop',
      'browser-image-compression',
      'react-markdown',
      'rehype-sanitize',
      'cmdk',
      'simple-icons',
    ],
  },
  server: {
    port: 5273,
    strictPort: true,
    // `*.localhost` resuelve a 127.0.0.1 en Chrome/Edge/Firefox (00 §4).
    allowedHosts: ['.localhost'],
  },
}));
