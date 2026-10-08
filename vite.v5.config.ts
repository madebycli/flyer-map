import { defineConfig } from 'vite';

// Standalone build of the v5 browser harness (no Cloudflare plugin): `vite build -c vite.v5.config.ts`.
export default defineConfig({
  root: 'src/v5/harness',
  base: './',
  build: { outDir: '../../../dist-v5-harness', emptyOutDir: true },
});
