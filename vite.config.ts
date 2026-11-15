// The Lovable preset supplies TanStack Start, React, Tailwind, and aliases.
// ADE builds a single-page app: `npm start` (src/local/server.mjs) serves its
// shell and assets next to the local API, and `npm run dev` mounts that API on
// Vite's server through adeLocalApi(). This file and src/local/server.mjs are
// the only importers of ade-local.mjs, which keeps it out of Lovable's bundle.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { adeLocalApi } from "./src/local/ade-local.mjs";
import { resolveBindHost } from "./src/local/bind-host.mjs";
import { DEFAULT_PORT } from "./src/shared/runtime-contract.mjs";
import path from "node:path";

// Loopback unless ADE_HOST opts in (which then requires ADE_TOKEN). The Lovable
// sandbox preset forces its own host/port on the dev server regardless.
const host = resolveBindHost();

export default defineConfig({
  plugins: [
    adeLocalApi(),
    {
      // Two Vite servers on different ports must not replace each other's
      // optimized dependency files while browsers are still using them.
      name: "ade-isolate-dev-cache",
      enforce: "post",
      config(config, env) {
        if (env.command !== "serve" || env.isPreview) return;
        const port = config.server?.port ?? DEFAULT_PORT;
        return {
          cacheDir: path.resolve(
            config.root ?? process.cwd(),
            "node_modules/.vite",
            `ade-${port || process.pid}`,
          ),
        };
      },
    },
  ],
  vite: {
    // ADE's normal local port. 8080 (the preset default) is commonly taken by
    // other local services (e.g. a llama.cpp server) and failing to start is
    // worse than a fixed well-known port; override with --port for a one-off.
    server: {
      host,
      port: DEFAULT_PORT,
      strictPort: true,
      // Builds and package staging are outputs, not source edits. Watching
      // their generated HTML makes an open development session reload.
      watch: { ignored: ["**/.output/**", "**/.pack/**"] },
    },
    preview: { host, port: DEFAULT_PORT, strictPort: true },
  },
  tanstackStart: {
    // Lovable builds its hosted server from src/server.ts; ADE itself never runs it.
    server: { entry: "server" },
    // No route renders on the server: the build prerenders one shell HTML
    // (<client outDir>/_shell.html) for every path, and the UI loads its data from /api.
    spa: { enabled: true },
  },
});
