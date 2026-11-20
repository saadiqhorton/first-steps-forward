import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const emptyState = () => ({
  version: 1,
  setup: { status: "none" },
  changes: [],
  current: { stock: true, sha: null },
  switch: { status: "idle" },
  update: null,
});

/** state.json with private permissions, written atomically. */
export function createStore(file) {
  return {
    async load() {
      try {
        const saved = JSON.parse(await fs.readFile(file, "utf8"));
        return {
          ...emptyState(),
          ...saved,
          changes: Array.isArray(saved.changes) ? saved.changes : [],
        };
      } catch (error) {
        if (error.code === "ENOENT" || error instanceof SyntaxError) return emptyState();
        throw error;
      }
    },
    async save(state) {
      await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      const tmp = `${file}.${randomUUID()}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
      await fs.rename(tmp, file);
    },
  };
}
