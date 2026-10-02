// The Lovable preset supplies TanStack Start, React, Tailwind, and aliases.
// ADE pins the self-hosted server to Node and its UI/API to loopback.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { adeLocalApi } from "./src/local/ade-local.mjs";

export default defineConfig({
  plugins: [adeLocalApi()],
  vite: {
    // ADE's normal local port. 8080 (the preset default) is commonly taken by
    // other local services (e.g. a llama.cpp server) and failing to start is
    // worse than a fixed well-known port; override with --port for a one-off.
    server: { host: "127.0.0.1", port: 3100, strictPort: true },
    preview: { host: "127.0.0.1", port: 3100, strictPort: true },
  },
  nitro: { preset: "node-server" },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
