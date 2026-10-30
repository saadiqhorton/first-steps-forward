// Every agent ADE can run, by id. Each `<id>.agent.mjs` file in this folder
// exports one agent adapter (see kit.mjs); adding an agent is adding a file.
// Under Vite (the dev server's SSR and the production build) the files are
// found with import.meta.glob; elsewhere (node --test, the config-loaded
// dev middleware) by reading this folder.
import { readdir } from "node:fs/promises";

/** @returns {Promise<Record<string, Record<string, unknown>>>} */
async function readFolder() {
  const folder = new URL(".", import.meta.url);
  const names = (await readdir(folder)).filter((name) => name.endsWith(".agent.mjs"));
  const modules = await Promise.all(names.map((name) => import(new URL(name, folder).href)));
  return Object.fromEntries(names.map((name, i) => [name, modules[i]]));
}

const modules = import.meta.env
  ? import.meta.glob("./*.agent.mjs", { eager: true })
  : await readFolder();

const isAdapter = (value) =>
  !!value && typeof value === "object" && typeof value.id === "string" && "runTurn" in value;

/** Agent adapters by id, in each profile's `order` (then by name). */
export const adapters = Object.fromEntries(
  Object.values(modules)
    .flatMap((exports) => Object.values(exports).filter(isAdapter))
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.name.localeCompare(b.name))
    .map((adapter) => [adapter.id, adapter]),
);
