import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    react(),
    cloudflare({
      viteEnvironment: { name: "flyer_map" },
    }),
  ],
  build: {
    sourcemap: true,
  },
  environments: {
    // v5 field core ships as a second page next to the existing app (served at /v5).
    client: { build: { rollupOptions: { input: { main: "index.html", v5: "v5.html" } } } },
  },
});
