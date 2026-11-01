import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createSessionLogs } from "./session-logs.mjs";

test("session logs append as private JSONL and compact to the latest 500 records", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "ade-session-logs-test-"));
  const directory = path.join(home, "session-logs");
  const logs = createSessionLogs(directory);
  try {
    for (let i = 0; i < 1001; i++) await logs.append("session-1", `line ${i}`);
    const result = await logs.read("session-1", 500);
    assert.equal(result.reset, true);
    assert.equal(result.lines.length, 500);
    assert.equal(result.lines[0].n, 502);
    assert.equal(result.lines.at(-1).text, "line 1000");
    assert.equal(result.next, 1001);
    assert.equal((await stat(directory)).mode & 0o777, 0o700);
    const file = path.join(directory, "session-1.jsonl");
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.equal((await readFile(file, "utf8")).trim().split("\n").length, 500);
    assert.deepEqual(await readdir(directory), ["session-1.jsonl"]);
    await logs.append("session-1", "after compaction");
    assert.equal((await logs.read("session-1", 1001)).lines[0].text, "after compaction");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("legacy session logs migrate to JSONL and stay out of the workspace object", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "ade-session-log-migration-"));
  const logs = createSessionLogs(path.join(home, "session-logs"));
  try {
    const sessions = [{ id: "session-2", logs: ["old one", "old two"] }];
    assert.equal(await logs.migrate(sessions), true);
    assert.equal("logs" in sessions[0], false);
    assert.deepEqual(
      (await logs.read("session-2")).lines.map((item) => item.text),
      ["old one", "old two"],
    );
    delete sessions[0].logs;
    assert.equal(await logs.migrate(sessions), false);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
