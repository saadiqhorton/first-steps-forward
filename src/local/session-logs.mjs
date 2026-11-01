import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const TAIL = 500;
const COMPACT_AT = TAIL * 2;
const SAFE_ID = /^[a-zA-Z0-9_-]{1,128}$/;

/** Append-only JSONL storage with a bounded cache for recently active sessions. */
export function createSessionLogs(directory, { maxCached = 100 } = {}) {
  const cache = new Map();
  const writes = new Map();
  const filename = (id) => {
    if (!SAFE_ID.test(id)) throw new Error("Invalid session id.");
    return path.join(directory, `${id}.jsonl`);
  };
  const touch = (id, entry) => {
    cache.delete(id);
    cache.set(id, entry);
    while (cache.size > maxCached) cache.delete(cache.keys().next().value);
    return entry;
  };
  const load = async (id) => {
    const known = cache.get(id);
    if (known) return touch(id, known);
    let records = [];
    try {
      const content = await fs.readFile(filename(id), "utf8");
      records = content
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .filter((item) => Number.isSafeInteger(item.n) && typeof item.text === "string");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    return touch(id, {
      next: records.length ? Math.max(...records.map((item) => item.n)) + 1 : 1,
      count: records.length,
      tail: records.slice(-TAIL),
    });
  };
  const serialize = (id, operation) => {
    const prior = writes.get(id) ?? Promise.resolve();
    const next = prior.catch(() => {}).then(operation);
    writes.set(id, next);
    void next.finally(() => {
      if (writes.get(id) === next) writes.delete(id);
    });
    return next;
  };
  const compact = async (id, entry) => {
    const target = filename(id);
    const temp = `${target}.${process.pid}.${randomUUID()}.tmp`;
    const data = entry.tail.map((item) => JSON.stringify(item)).join("\n") + "\n";
    try {
      await fs.writeFile(temp, data, { mode: 0o600 });
      await fs.chmod(temp, 0o600);
      await fs.rename(temp, target);
      entry.count = entry.tail.length;
    } finally {
      await fs.rm(temp, { force: true });
    }
  };

  return {
    async append(id, text) {
      return serialize(id, async () => {
        await fs.mkdir(directory, { recursive: true, mode: 0o700 });
        await fs.chmod(directory, 0o700);
        const entry = await load(id);
        const record = { n: entry.next++, text };
        await fs.appendFile(filename(id), `${JSON.stringify(record)}\n`, { mode: 0o600 });
        await fs.chmod(filename(id), 0o600);
        entry.count += 1;
        entry.tail = [...entry.tail, record].slice(-TAIL);
        if (entry.count > COMPACT_AT) await compact(id, entry);
        return record;
      });
    },
    async read(id, after = 0) {
      const entry = await load(id);
      const first = entry.tail[0]?.n ?? entry.next;
      const reset = after > 0 && after < first - 1;
      const lines = reset ? entry.tail : entry.tail.filter((item) => item.n > after);
      return { lines, next: entry.next - 1, reset };
    },
    async migrate(sessions) {
      let changed = false;
      for (const session of sessions) {
        const legacy = Array.isArray(session.logs) ? session.logs : [];
        const entry = await load(session.id);
        if (legacy.length && entry.next === 1) {
          for (const text of legacy) await this.append(session.id, text);
          changed = true;
        }
        delete session.logs;
      }
      return changed;
    },
    async remove(id) {
      await writes.get(id)?.catch(() => {});
      cache.delete(id);
      await fs.rm(filename(id), { force: true });
    },
    async flush(id) {
      await writes.get(id);
    },
    getTail(id) {
      return cache.get(id)?.tail.map((item) => item.text) ?? [];
    },
  };
}
