import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { brewUpdateCommand, checkBrewUpdate, detectBrewInstall } from "./harness-brew.mjs";

const prefix = path.join(path.sep, "opt", "homebrew");
const caskBin = path.join(prefix, "bin", "codex");
const caskFile = path.join(prefix, "Caskroom", "codex", "0.169.0", "bin", "codex");

function deps(overrides = {}) {
  return {
    which: async (bin) => (bin === "brew" ? path.join(prefix, "bin", "brew") : null),
    realpath: async (p) => {
      assert.equal(p, caskBin);
      return caskFile;
    },
    run: async (bin, args) => {
      assert.equal(bin, "brew");
      if (args[0] === "info") {
        return {
          code: 0,
          stdout: JSON.stringify({
            formulae: [{ full_name: "opencode" }],
            casks: [{ full_token: "codex" }, { full_token: "claude-code" }],
          }),
        };
      }
      if (args[0] === "list" && args[2] === "--cask" && args[3] === "codex")
        return { code: 0, stdout: `${caskFile}\n` };
      if (args[0] === "list") return { code: 0, stdout: "" };
      throw new Error(`unexpected brew call: ${args.join(" ")}`);
    },
    ...overrides,
  };
}

test("detectBrewInstall finds the one allowlisted Homebrew cask that owns the executable", async () => {
  const found = await detectBrewInstall(caskBin, [{ kind: "cask", name: "codex" }], deps());
  assert.deepEqual(found, {
    method: "brew",
    path: caskBin,
    brewItem: { kind: "cask", name: "codex" },
  });
});

test("detectBrewInstall refuses unknown, missing, or ambiguous ownership", async () => {
  const allowed = [{ kind: "cask", name: "codex" }];
  // brew is not on PATH: never guess a manager.
  assert.equal(await detectBrewInstall(caskBin, allowed, deps({ which: async () => null })), null);
  // The item is not in `brew info --installed`.
  assert.equal(await detectBrewInstall(caskBin, [{ kind: "cask", name: "other" }], deps()), null);
  // Two allowlisted items claim the same file.
  assert.equal(
    await detectBrewInstall(
      caskBin,
      [
        { kind: "cask", name: "codex" },
        { kind: "cask", name: "claude-code" },
      ],
      deps({
        run: async (bin, args) => {
          if (args[0] === "info")
            return {
              code: 0,
              stdout: JSON.stringify({
                formulae: [],
                casks: [{ full_token: "codex" }, { full_token: "claude-code" }],
              }),
            };
          return { code: 0, stdout: `${caskFile}\n` };
        },
      }),
    ),
    null,
  );
  // A failed file listing could hide a second owner.
  assert.equal(
    await detectBrewInstall(
      caskBin,
      allowed,
      deps({
        run: async (bin, args) =>
          args[0] === "info"
            ? {
                code: 0,
                stdout: JSON.stringify({ formulae: [], casks: [{ full_token: "codex" }] }),
              }
            : { code: 1, stdout: "" },
      }),
    ),
    null,
  );
  // Unrecognized item shapes are rejected before any process runs.
  assert.equal(await detectBrewInstall(caskBin, [{ kind: "tap", name: "x" }], deps()), null);
  assert.equal(await detectBrewInstall("codex", allowed, deps()), null);
});

test("brewUpdateCommand accepts only a validated formula or cask item", () => {
  assert.deepEqual(brewUpdateCommand({ kind: "cask", name: "codex" }), [
    "brew",
    ["upgrade", "--cask", "codex"],
  ]);
  assert.deepEqual(brewUpdateCommand({ kind: "formula", name: "opencode" }), [
    "brew",
    ["upgrade", "--formula", "opencode"],
  ]);
  assert.equal(brewUpdateCommand({ kind: "cask", name: "codex; whoami" }), null);
  assert.equal(brewUpdateCommand({ kind: "tap", name: "codex" }), null);
  assert.equal(brewUpdateCommand(null), null);
});

test("checkBrewUpdate reads Homebrew's own outdated answer, including exit status 1", async () => {
  const item = { kind: "cask", name: "codex" };
  const outdated = await checkBrewUpdate(item, async (bin, args, options) => {
    assert.deepEqual(args, ["outdated", "--json=v2", "--cask", "codex"]);
    assert.equal(options.timeout, 15000);
    return {
      code: 1,
      stdout: JSON.stringify({
        formulae: [],
        casks: [{ name: "codex", current_version: "0.169.0", pinned: false }],
      }),
    };
  });
  assert.deepEqual(outdated, { outdated: true, latestVersion: "0.169.0", pinned: false });

  const current = await checkBrewUpdate(item, async () => ({
    code: 0,
    stdout: JSON.stringify({ formulae: [], casks: [] }),
  }));
  assert.deepEqual(current, { outdated: false, latestVersion: null, pinned: false });
});

test("checkBrewUpdate returns null rather than guessing at an unexpected answer", async () => {
  const item = { kind: "formula", name: "opencode" };
  // Exit status 0 with no rows is current; status 1 with no rows is a failure.
  assert.equal(
    await checkBrewUpdate(item, async () => ({ code: 1, stdout: '{"formulae":[],"casks":[]}' })),
    null,
  );
  // The other package kind in the same answer means the query was not scoped.
  assert.equal(
    await checkBrewUpdate(item, async () => ({
      code: 0,
      stdout: JSON.stringify({ formulae: [], casks: [{ name: "codex", current_version: "1" }] }),
    })),
    null,
  );
  // A row for a different item is not this item's answer.
  assert.equal(
    await checkBrewUpdate(item, async () => ({
      code: 1,
      stdout: JSON.stringify({
        formulae: [{ name: "other", current_version: "1.0.0" }],
        casks: [],
      }),
    })),
    null,
  );
  // Malformed output and a thrown run are both unknown.
  assert.equal(await checkBrewUpdate(item, async () => ({ code: 0, stdout: "not json" })), null);
  assert.equal(
    await checkBrewUpdate(item, async () => {
      throw new Error("spawn failed");
    }),
    null,
  );
  assert.equal(await checkBrewUpdate({ kind: "formula", name: "a/b/c/d" }, async () => ({})), null);
});
