import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// The `ade` command itself: nothing else imports bin/ade.mjs, so a syntax error there would
// otherwise only show up when someone runs the published package.
const bin = fileURLToPath(new URL("../../bin/ade.mjs", import.meta.url));
const ade = (...args) => spawnSync(process.execPath, [bin, ...args], { encoding: "utf8" });

test("ade --help prints the usage, with 3100 as the default port", () => {
  const res = ade("--help");
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /^Usage: ade /);
  assert.match(res.stdout, /--remote/);
  assert.match(res.stdout, /default 3100/);
});

test("ade refuses unknown commands and --remote with --host", () => {
  assert.equal(ade("nonsense").status, 1);
  const both = ade("--remote", "--host", "0.0.0.0");
  assert.equal(both.status, 1);
  assert.match(both.stderr, /either --remote or --host/);
});
