import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const home = mkdtempSync(path.join(os.tmpdir(), "ade-terminal-idle-"));
process.env.HOME = home;
process.env.USERPROFILE = home;

const { openTerminal, closeTerminal, readTerminal, reapIdleTerminals, IDLE_MS } =
  await import("./terminal.mjs");

test("unpolled terminals are reaped after IDLE_MS", async () => {
  const session = openTerminal(home, { cols: 80, rows: 24 });
  try {
    assert.ok(await readTerminal(session.id, 0, 0), "session exists immediately after open");

    // Reading refreshed lastSeen; a sweep at "now" must leave it alone.
    reapIdleTerminals(Date.now());
    assert.ok(await readTerminal(session.id, 0, 0), "session survives before IDLE_MS");

    // Stop refreshing lastSeen. Advance past idle and sweep — session must go.
    const afterIdle = Date.now() + IDLE_MS + 1;
    reapIdleTerminals(afterIdle);
    assert.equal(await readTerminal(session.id, 0, 0), null, "session is gone after idle reap");
  } finally {
    closeTerminal(session.id);
  }
});

process.once("exit", () => rmSync(home, { recursive: true, force: true }));
