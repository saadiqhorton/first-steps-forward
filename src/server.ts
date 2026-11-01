// Lovable's hosted build needs this server entry (tanstackStart.server.entry in
// vite.config.ts). ADE never runs it: `npm start` serves the SPA build with
// src/local/server.mjs. Do not import src/local here; it would pull node-pty
// and the local API into Lovable's Cloudflare bundle.
export { default } from "@tanstack/react-start/server-entry";
