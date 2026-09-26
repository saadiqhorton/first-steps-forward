import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import {
  parseCodexModels,
  parseOpencodeModels,
  parsePiModels,
  listModels,
  clearModelsCache,
  MODEL_ID,
} from "./models.mjs";

// Fixtures mirror the real shapes captured on this machine:
// codex-cli 0.154.0 `codex debug models`, opencode 1.18.30 `opencode models`,
// pi 0.85.1 `pi --offline --list-models` (including a pi extension banner
// line printed before the table).
const CODEX_JSON = JSON.stringify({
  models: [
    {
      slug: "gpt-6-astra",
      display_name: "GPT-6-Astra",
      description: "Frontier intelligence.",
      default_reasoning_level: "low",
      visibility: "list",
      priority: 1,
      supported_in_api: true,
    },
    { slug: "gpt-reserve", display_name: "GPT-Reserve", visibility: "hide", priority: 3 },
    { slug: "gpt-5.6-sol", display_name: "GPT-5.6-Sol", visibility: "list", priority: 4 },
    { slug: "gpt-5.6-luna", display_name: "GPT-5.6-Luna", visibility: "list", priority: 8 },
    { slug: "gpt-5.5", visibility: "list", priority: 12 },
    {
      slug: "codex-auto-review",
      display_name: "Codex Auto Review",
      visibility: "hide",
      priority: 43,
    },
  ],
});

const OPENCODE_LINES = [
  "opencode/big-pickle",
  "opencode-go/deepseek-v4-flash",
  "opencode-go/gpt-5.6-luna",
  "opencode-go/qwen3.8-max",
  "",
].join("\n");

const PI_TABLE = [
  "[pi-subagents] loaded 3 extensions",
  "provider     model                         context  max-out  thinking  images",
  "opencode-go  deepseek-v4-flash             1M       384K     yes       no    ",
  "opencode-go  gpt-5.6-luna                  1.1M     128K     yes       yes   ",
  "opencode-go  glm-5.1                       202.8K   32.8K    yes       no",
].join("\n");

test("parseCodexModels keeps only visibility=list and sorts by priority", () => {
  const models = parseCodexModels(CODEX_JSON);
  assert.deepEqual(
    models.map((m) => m.id),
    ["gpt-6-astra", "gpt-5.6-sol", "gpt-5.6-luna", "gpt-5.5"],
  );
  assert.equal(models[0].label, "GPT-6-Astra");
  assert.equal(models[3].label, undefined, "no display_name means no label");
  assert.equal(parseCodexModels("not json"), null);
  assert.equal(parseCodexModels("{}"), null);
});

test("parseOpencodeModels reads plain provider/model lines", () => {
  assert.deepEqual(parseOpencodeModels(OPENCODE_LINES), [
    { id: "opencode/big-pickle" },
    { id: "opencode-go/deepseek-v4-flash" },
    { id: "opencode-go/gpt-5.6-luna" },
    { id: "opencode-go/qwen3.8-max" },
  ]);
  assert.deepEqual(parseOpencodeModels(""), []);
});

test("parsePiModels skips extension banner lines and parses the table", () => {
  const models = parsePiModels(PI_TABLE);
  assert.deepEqual(
    models.map((m) => m.id),
    ["opencode-go/deepseek-v4-flash", "opencode-go/gpt-5.6-luna", "opencode-go/glm-5.1"],
  );
  assert.equal(models[0].label, "deepseek-v4-flash");
  assert.equal(models[0].meta, "context 1M · max-out 384K");
  assert.deepEqual(parsePiModels("provider model context max-out thinking images"), []);
});

test("MODEL_ID refuses flag-looking values and accepts real ids", () => {
  assert.ok(MODEL_ID.test("gpt-5.5"));
  assert.ok(MODEL_ID.test("opencode-go/gpt-5.6-luna"));
  assert.ok(MODEL_ID.test("provider/a/b"), "model part may contain slashes");
  assert.ok(MODEL_ID.test("provider/model:thinking"));
  assert.ok(MODEL_ID.test("openai/gpt-5[1m]"));
  assert.ok(!MODEL_ID.test("--model"), "must never read as a CLI flag");
  assert.ok(!MODEL_ID.test("-x"));
  assert.ok(!MODEL_ID.test("/leading"));
  assert.ok(!MODEL_ID.test(":colon"));
  assert.ok(!MODEL_ID.test("definitely-not-a-model!!"));
  assert.ok(!MODEL_ID.test("has space"));
  assert.ok(!MODEL_ID.test("x".repeat(257)));
});

const fakeRun = (responses) => {
  const fn = async (bin, args) => {
    fn.calls.push([bin, ...args]);
    const key = args.join(" ");
    const res = responses[key] ?? responses.default ?? { code: 0, stdout: "", stderr: "" };
    return typeof res === "function" ? res(bin, args) : res;
  };
  fn.calls = [];
  return fn;
};

test("listModels caches per agent+version for the TTL and flags cache hits", async () => {
  clearModelsCache();
  const run = fakeRun({ "debug models": { code: 0, stdout: CODEX_JSON } });
  const first = await listModels("codex", run, { version: "0.154.0", now: 1000 });
  assert.equal(first.available, true);
  assert.equal(first.cached, undefined);
  assert.equal(first.source, "live");
  const second = await listModels("codex", run, { version: "0.154.0", now: 2000 });
  assert.equal(second.cached, true);
  assert.equal(run.calls.length, 1, "TTL hit must not re-spawn");
  // TTL expiry re-probes.
  await listModels("codex", run, { version: "0.154.0", now: 62_000 });
  assert.equal(run.calls.length, 2);
  // A different CLI version is a different cache key (no stale catalog).
  await listModels("codex", run, { version: "0.155.0", now: 62_001 });
  assert.equal(run.calls.length, 3);
});

test("codex falls back to the bundled catalog when the live probe fails", async () => {
  clearModelsCache();
  const run = fakeRun({
    "debug models": { code: 1, stdout: "", stderr: "cache refresh failed" },
    "debug models --bundled": { code: 0, stdout: CODEX_JSON },
  });
  const result = await listModels("codex", run, { now: 1 });
  assert.equal(result.available, true);
  assert.equal(result.source, "bundled");
  assert.equal(result.command, "codex debug models --bundled");
  assert.deepEqual(
    run.calls.map((c) => c.join(" ")),
    ["codex debug models", "codex debug models --bundled"],
  );
});

test("structured failures distinguish not-installed, cli-failed, and no providers", async () => {
  clearModelsCache();
  // Real ENOENT path: spawn with an empty PATH so pi cannot be found.
  const strippedPathRun = (bin, args) =>
    new Promise((resolve) => {
      const child = spawn(bin, args, {
        env: { PATH: "" },
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("error", (e) => resolve({ code: 127, stdout, stderr: `${stderr}${e.message}` }));
      child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    });
  const missing = await listModels("pi", strippedPathRun, { version: "none" });
  assert.equal(missing.available, false);
  assert.equal(missing.reason, "not-installed");
  assert.match(missing.hint, /enter a model id manually/i);

  clearModelsCache();
  const failing = fakeRun({ default: { code: 1, stdout: "", stderr: "boom" } });
  const cliFailed = await listModels("opencode", failing, { version: "1.18.30" });
  assert.equal(cliFailed.available, false);
  assert.equal(cliFailed.reason, "cli-failed");

  clearModelsCache();
  const emptyList = fakeRun({ models: { code: 0, stdout: "\n" } });
  const none = await listModels("opencode", emptyList, { version: "1.18.30" });
  assert.equal(none.available, false);
  assert.equal(none.reason, "no-providers-configured");
});

test("file cache under cacheDir survives the memory cache but not a version change", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(path.join(tmpdir(), "ade-models-"));
  try {
    clearModelsCache();
    const run = fakeRun({ models: { code: 0, stdout: OPENCODE_LINES } });
    const first = await listModels("opencode", run, { version: "1.18.30", cacheDir: dir });
    assert.equal(first.cached, undefined);
    assert.equal(run.calls.length, 1);
    // Simulate a server restart: memory cache gone, file cache still fresh.
    clearModelsCache();
    const second = await listModels("opencode", run, { version: "1.18.30", cacheDir: dir });
    assert.equal(second.cached, true);
    assert.equal(second.models.length, 4);
    assert.equal(run.calls.length, 1, "file cache hit must not re-spawn");
    // Upgraded CLI: fingerprint mismatch forces a re-probe (no stale rows).
    clearModelsCache();
    await listModels("opencode", run, { version: "2.0.0", cacheDir: dir });
    assert.equal(run.calls.length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
