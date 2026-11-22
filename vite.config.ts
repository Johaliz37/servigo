import { fileURLToPath, URL } from 'node:url';
import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const alias = {
  '@client': fileURLToPath(new URL('./src/client', import.meta.url)),
  '@worker': fileURLToPath(new URL('./src/worker', import.meta.url)),
  '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
};

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
  resolve: { alias },
  server: {
    port: 5273,
    strictPort: true,
    // `*.localhost` resuelve a 127.0.0.1 en Chrome/Edge/Firefox (00 §4).
    allowedHosts: ['.localhost'],
  },
});
