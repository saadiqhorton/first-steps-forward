// What the npm package ships as `self-source/` for Customize ADE: tracked source only,
// never secrets or private machine state.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tempDir, git } from "./fixture.test-helper.mjs";

const { assertNoSecrets, isSecretLike, selfSourceFiles, stageSelfSource } =
  await import("../../../scripts/self-source.mjs");

function repoWith(files) {
  const dir = tempDir("ade-selfsrc-");
  git(dir, "init", "-q");
  for (const file of files) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), file);
  }
  git(dir, "add", "-f", "-A");
  git(dir, "commit", "-q", "-m", "x");
  return dir;
}

test("self-source keeps tracked source and drops build output, notes and secret-like files", async () => {
  const keep = [
    "package.json",
    "package-lock.json",
    "src/local/a.mjs",
    "src/local/a.test.mjs",
    "src/x.d.mts",
    "design/a.md",
    "docs/a.md",
    "public/a.png",
    "scripts/a.mjs",
  ];
  const drop = [
    "node_modules/x/index.js",
    ".output/public/a.js",
    "artifacts/a.png",
    "cook/BRIEF.md",
    "cook-archive/a",
    "tmp/a",
    ".pack/a",
    ".env",
    ".env.local",
    "src/.env.production",
    "keys/server.pem",
    "keys/a.key",
    ".claude/settings.local.json",
    "remote-token",
  ];
  const repo = repoWith([...keep, ...drop]);
  assert.deepEqual(selfSourceFiles(repo).sort(), [...keep].sort());
  const dest = path.join(tempDir("ade-selfsrc-out-"), "self-source");
  await stageSelfSource(repo, dest);
  for (const file of keep) assert.ok(existsSync(path.join(dest, file)), file);
  for (const file of drop) assert.ok(!existsSync(path.join(dest, file)), file);
});

test("packaging fails when a secret-like file is in self-source", async () => {
  for (const name of [
    ".env",
    ".env.local",
    "a.pem",
    "deep/a.key",
    ".claude/settings.local.json",
    "remote-token",
  ]) {
    const dir = tempDir("ade-selfsrc-bad-");
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), "secret");
    await assert.rejects(assertNoSecrets(dir), /secret-like files/, name);
  }
  await assertNoSecrets(tempDir("ade-selfsrc-good-"));
  assert.equal(isSecretLike("src/environment.ts"), false);
  assert.equal(isSecretLike("src/monkey.mjs"), false);
});

test("this repository's own source is staged complete", () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const files = new Set(selfSourceFiles(root));
  for (const file of [
    "package.json",
    "package-lock.json",
    "src/local/ade-local.mjs",
    "bin/ade.mjs",
    "src/tokens.css",
    "vite.config.ts",
  ])
    assert.ok(files.has(file), file);
  assert.ok(
    [...files].every((file) => !file.startsWith("node_modules/") && !file.startsWith("cook/")),
  );
});
