import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { codex, parseCodexModels } from "./adapters/codex.agent.mjs";
import {
  opencode,
  parseOpencodeModels,
  parseOpencodeVerboseModels,
} from "./adapters/opencode.agent.mjs";
import { pi, parsePiModels, PI_THINKING_LEVELS } from "./adapters/pi.agent.mjs";
import { acpModelListing, clearModelsCache, rememberAcpModels, MODEL_ID } from "./models.mjs";

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
  "openai-codex gpt-5.5                    128K     16K      yes       yes",
  "ollama-cloud qwen3.5                    128K     16K      yes       no",
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
    [
      "opencode-go/deepseek-v4-flash",
      "opencode-go/gpt-5.6-luna",
      "opencode-go/glm-5.1",
      "openai-codex/gpt-5.5",
      "ollama-cloud/qwen3.5",
    ],
  );
  assert.equal(models[0].label, "deepseek-v4-flash");
  assert.equal(models[0].meta, "context 1M · max-out 384K");
  assert.deepEqual(parsePiModels("provider model context max-out thinking images"), []);
});

test("Pi model catalog includes extension models without asserting their auth status", async () => {
  clearModelsCache();
  const run = fakeRun({ "--offline --list-models": { code: 0, stdout: PI_TABLE } });
  const result = await pi.listModels({ run, version: "0.87.1" });
  assert.equal(result.available, true);
  assert.deepEqual([...new Set(result.models.map((m) => m.id.split("/")[0]))].sort(), [
    "ollama-cloud",
    "openai-codex",
    "opencode-go",
  ]);
  assert.deepEqual(run.calls, [["pi", "--offline", "--list-models"]]);
});

test("MODEL_ID refuses flag-looking values and accepts real ids", () => {
  assert.ok(MODEL_ID.test("gpt-5.5"));
  assert.ok(MODEL_ID.test("opencode-go/gpt-5.6-luna"));
  assert.ok(MODEL_ID.test("provider/a/b"), "model part may contain slashes");
  assert.ok(MODEL_ID.test("provider/model:thinking"));
  assert.ok(
    MODEL_ID.test("openrouter/~anthropic/claude-sonnet-latest"),
    "OpenRouter aliases use ~",
  );
  assert.equal(MODEL_ID.test("--flag"), false);
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
  const first = await codex.listModels({ run, version: "0.154.0", now: 1000 });
  assert.equal(first.available, true);
  assert.equal(first.cached, undefined);
  assert.equal(first.source, "live");
  const second = await codex.listModels({ run, version: "0.154.0", now: 2000 });
  assert.equal(second.cached, true);
  assert.equal(run.calls.length, 1, "TTL hit must not re-spawn");
  // TTL expiry re-probes.
  await codex.listModels({ run, version: "0.154.0", now: 62_000 });
  assert.equal(run.calls.length, 2);
  // A different CLI version is a different cache key (no stale catalog).
  await codex.listModels({ run, version: "0.155.0", now: 62_001 });
  assert.equal(run.calls.length, 3);
});

test("codex falls back to the bundled catalog when the live probe fails", async () => {
  clearModelsCache();
  const run = fakeRun({
    "debug models": { code: 1, stdout: "", stderr: "cache refresh failed" },
    "debug models --bundled": { code: 0, stdout: CODEX_JSON },
  });
  const result = await codex.listModels({ run, now: 1 });
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
  const missing = await pi.listModels({ run: strippedPathRun, version: "none" });
  assert.equal(missing.available, false);
  assert.equal(missing.reason, "not-installed");
  assert.match(missing.hint, /enter a model id manually/i);

  clearModelsCache();
  const noPiRows = fakeRun({ "--offline --list-models": { code: 0, stdout: "" } });
  const piEmpty = await pi.listModels({ run: noPiRows, version: "0.87.1" });
  assert.equal(piEmpty.available, false);
  assert.match(piEmpty.hint, /does not indicate whether any provider is READY/);

  clearModelsCache();
  const failing = fakeRun({ default: { code: 1, stdout: "", stderr: "boom" } });
  const cliFailed = await opencode.listModels({ run: failing, version: "1.18.30" });
  assert.equal(cliFailed.available, false);
  assert.equal(cliFailed.reason, "cli-failed");

  clearModelsCache();
  const emptyList = fakeRun({ models: { code: 0, stdout: "\n" } });
  const none = await opencode.listModels({ run: emptyList, version: "1.18.30" });
  assert.equal(none.available, false);
  assert.equal(none.reason, "no-providers-configured");
});

test("file cache under cacheDir survives the memory cache but not a version change", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(path.join(tmpdir(), "ade-models-"));
  try {
    clearModelsCache();
    // Verbose probe fails to parse empty stdout, so the probe falls back to plain `models`.
    const run = fakeRun({ models: { code: 0, stdout: OPENCODE_LINES } });
    const first = await opencode.listModels({ run, version: "1.18.30", cacheDir: dir });
    assert.equal(first.cached, undefined);
    assert.equal(run.calls.length, 2, "verbose then plain fallback");
    // Simulate a server restart: memory cache gone, file cache still fresh.
    clearModelsCache();
    const second = await opencode.listModels({ run, version: "1.18.30", cacheDir: dir });
    assert.equal(second.cached, true);
    assert.equal(second.models.length, 4);
    assert.equal(run.calls.length, 2, "file cache hit must not re-spawn");
    // Upgraded CLI: fingerprint mismatch forces a re-probe (no stale rows).
    clearModelsCache();
    await opencode.listModels({ run, version: "2.0.0", cacheDir: dir });
    assert.equal(run.calls.length, 4);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const CODEX_WITH_OPTIONS = JSON.stringify({
  models: [
    {
      slug: "gpt-6-astra",
      display_name: "GPT-6-Astra",
      default_reasoning_level: "low",
      visibility: "list",
      priority: 1,
      supported_reasoning_levels: [
        { effort: "low", description: "Fast" },
        { effort: "medium", description: "Balanced" },
        { effort: "high", description: "Deep" },
        { effort: "xhigh", description: "Extra" },
        { effort: "max", description: "Max" },
        { effort: "ultra", description: "Ultra" },
      ],
      additional_speed_tiers: ["fast"],
    },
    {
      slug: "gpt-basic",
      visibility: "list",
      priority: 2,
    },
  ],
});

test("parseCodexModels carries efforts, defaultEffort, and speeds from the catalog", () => {
  const models = parseCodexModels(CODEX_WITH_OPTIONS);
  assert.deepEqual(models[0].efforts, ["low", "medium", "high", "xhigh", "max", "ultra"]);
  assert.equal(models[0].defaultEffort, "low");
  assert.deepEqual(models[0].speeds, ["fast"]);
  assert.equal(models[1].efforts, undefined);
  assert.equal(models[1].defaultEffort, undefined);
  assert.equal(models[1].speeds, undefined);
});

const OPENCODE_VERBOSE = [
  "opencode/big-pickle",
  "{",
  '  "id": "big-pickle",',
  '  "variants": {}',
  "}",
  "opencode/ling-3.0-flash",
  "{",
  '  "id": "ling-3.0-flash",',
  '  "variants": {',
  '    "low": { "reasoningEffort": "low" },',
  '    "medium": { "reasoningEffort": "medium" },',
  '    "high": { "reasoningEffort": "high" }',
  "  }",
  "}",
  "",
].join("\n");

test("parseOpencodeVerboseModels reads variants as efforts (empty map → [])", () => {
  const models = parseOpencodeVerboseModels(OPENCODE_VERBOSE);
  assert.deepEqual(models, [
    { id: "opencode/big-pickle", efforts: [] },
    { id: "opencode/ling-3.0-flash", efforts: ["low", "medium", "high"] },
  ]);
  assert.equal(parseOpencodeVerboseModels("not verbose"), null);
  assert.equal(parseOpencodeVerboseModels(""), null);
  assert.equal(parseOpencodeVerboseModels("opencode/x\n{not json}"), null);
});

const PI_THINKING_TABLE = [
  "provider     model              context  max-out  thinking  images",
  "opencode-go  deepseek-v4-flash  1M       384K     yes       no",
  "llamacpp     plain-model        128K     16K      no        yes",
].join("\n");

test("parsePiModels adds PI_THINKING_LEVELS when thinking is yes", () => {
  assert.deepEqual(PI_THINKING_LEVELS, ["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
  const models = parsePiModels(PI_THINKING_TABLE);
  assert.deepEqual(models[0].efforts, PI_THINKING_LEVELS);
  assert.equal(models[1].efforts, undefined);
});

test("opencode probe prefers models --verbose and falls back to plain models", async () => {
  clearModelsCache();
  const verboseRun = fakeRun({
    "models --verbose": { code: 0, stdout: OPENCODE_VERBOSE },
    // Cross-check against plain; same ids so verbose wins.
    models: { code: 0, stdout: "opencode/big-pickle\nopencode/ling-3.0-flash\n" },
  });
  const verbose = await opencode.listModels({ run: verboseRun, version: "1.18.33", now: 1 });
  assert.equal(verbose.available, true);
  assert.equal(verbose.command, "opencode models --verbose");
  assert.deepEqual(verbose.models[0].efforts, []);
  assert.deepEqual(verbose.models[1].efforts, ["low", "medium", "high"]);
  assert.deepEqual(
    verboseRun.calls.map((c) => c.slice(1).join(" ")),
    ["models --verbose", "models"],
  );

  clearModelsCache();
  const fallbackRun = fakeRun({
    "models --verbose": { code: 0, stdout: "garbage" },
    models: { code: 0, stdout: OPENCODE_LINES },
  });
  const fallback = await opencode.listModels({ run: fallbackRun, version: "1.18.33", now: 1 });
  assert.equal(fallback.available, true);
  assert.equal(fallback.command, "opencode models");
  assert.equal(fallback.models.length, 4);
  assert.deepEqual(
    fallbackRun.calls.map((c) => c.slice(1).join(" ")),
    ["models --verbose", "models"],
  );
});

test("opencode probe keeps plain ids when verbose returns a shorter list", async () => {
  clearModelsCache();
  const run = fakeRun({
    "models --verbose": { code: 0, stdout: OPENCODE_VERBOSE },
    models: {
      code: 0,
      stdout: "opencode/big-pickle\nopencode/ling-3.0-flash\nopenrouter/openai/gpt-4o\n",
    },
  });
  const result = await opencode.listModels({ run, version: "1.18.33", now: 1 });
  assert.equal(result.available, true);
  assert.equal(result.command, "opencode models");
  assert.deepEqual(
    result.models.map((m) => m.id),
    ["opencode/big-pickle", "opencode/ling-3.0-flash", "openrouter/openai/gpt-4o"],
  );
  assert.deepEqual(result.models[0].efforts, []);
  assert.deepEqual(result.models[1].efforts, ["low", "medium", "high"]);
  assert.equal(result.models[2].efforts, undefined);
});

test("ACP agents list the models they last reported, for the same CLI version only", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(path.join(tmpdir(), "ade-acp-models-"));
  const neverRun = async () => {
    throw new Error("ACP agents have no list command to run");
  };
  try {
    const before = await acpModelListing("claude", "Claude Code", {
      version: "0.99.0",
      cacheDir: dir,
    });
    assert.equal(before.available, false);
    assert.equal(before.reason, "acp-not-reported");
    await rememberAcpModels(dir, "claude", "0.99.0", [
      { id: "default", label: "Default" },
      { id: "opus", label: "Opus" },
      { id: "--flag-looking" },
    ]);
    const after = await acpModelListing("claude", "Claude Code", {
      version: "0.99.0",
      cacheDir: dir,
    });
    assert.equal(after.available, true);
    assert.equal(after.source, "acp");
    assert.deepEqual(
      after.models.map((m) => m.id),
      ["default", "opus"],
    );
    const upgraded = await acpModelListing("claude", "Claude Code", {
      version: "1.0.0",
      cacheDir: dir,
    });
    assert.equal(upgraded.available, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("with no list yet, ACP agents are asked once and the answer is kept", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(path.join(tmpdir(), "ade-acp-models-"));
  const neverRun = async () => {
    throw new Error("ACP agents have no list command to run");
  };
  try {
    let probes = 0;
    const probe = async () => {
      probes++;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return [{ id: "default", label: "Default" }, { id: "haiku" }];
    };
    const opts = { version: "2.1.307", cacheDir: dir, probe };
    // The picker asks for models and capabilities together: one probe.
    const [first, second] = await Promise.all([
      acpModelListing("claude", "Claude Code", opts),
      acpModelListing("claude", "Claude Code", opts),
    ]);
    assert.equal(probes, 1);
    assert.equal(first.source, "acp");
    assert.deepEqual(
      first.models.map((m) => m.id),
      ["default", "haiku"],
    );
    assert.deepEqual(second, first);
    assert.equal((await acpModelListing("claude", "Claude Code", opts)).available, true);
    assert.equal(probes, 1);

    // A failed probe is reported, not kept: the next call asks again.
    const failing = async () => {
      throw new Error("Authentication required: sign in");
    };
    const failed = await acpModelListing("claude", "Claude Code", {
      version: "2.1.308",
      cacheDir: dir,
      probe: failing,
    });
    assert.equal(failed.reason, "acp-probe-failed");
    assert.match(failed.hint, /^Authentication required: sign in/);
    const none = await acpModelListing("claude", "Claude Code", {
      version: "2.1.308",
      cacheDir: dir,
      probe: async () => [],
    });
    assert.equal(none.reason, "acp-no-models");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
