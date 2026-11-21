import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = process.cwd();
const here = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  root,
  publicDir: path.join(root, 'public'),
  plugins: [react(), tailwindcss()],
  resolve: { alias: [
    { find: '@/lib/ade/store', replacement: path.join(here, 'store.ts') },
    { find: '@/components/ade/ModelPicker', replacement: path.join(here, 'dialogs.tsx') },
    { find: '@/components/ade/SignInDialog', replacement: path.join(here, 'dialogs.tsx') },
    { find: '@/components/ade/HarnessDialog', replacement: path.join(here, 'dialogs.tsx') },
    { find: '@', replacement: path.join(root, 'src') },
  ] },
  server: { host: '127.0.0.1', strictPort: true },
});
