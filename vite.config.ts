// The Lovable preset supplies TanStack Start, React, Tailwind, and aliases.
// ADE pins the self-hosted server to Node and its UI/API to loopback.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { adeLocalApi } from "./src/local/ade-local.mjs";

export default defineConfig({
  plugins: [adeLocalApi()],
  vite: {
    server: { host: "127.0.0.1", strictPort: true },
    preview: { host: "127.0.0.1", strictPort: true },
  },
  nitro: { preset: "node-server" },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
