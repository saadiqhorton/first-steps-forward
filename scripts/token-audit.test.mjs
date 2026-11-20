import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  classifyLine,
  classifyLineAll,
  suggestToken,
  isSkippedPath,
  isEnforcePath,
  isDefinitionAllowlisted,
  TSX_RULES,
  auditFiles,
  countTsxByRule,
  isTsxSourceFile,
  scanTsxText,
} from "./token-audit.js";

/**
 * @param {string} text
 * @param {typeof TSX_RULES} [rules]
 */
function tsxFindings(text, rules) {
  const errors = [];
  const warnings = [];
  scanTsxText("src/components/ade/x.tsx", text, errors, warnings, rules);
  return { errors, warnings, all: [...errors, ...warnings] };
}

/**
 * @param {string} ruleId
 * @param {string} text
 */
function findingsFor(ruleId, text) {
  return tsxFindings(text).all.filter((f) => f.rule === ruleId);
}

test("skips generated paths", () => {
  assert.equal(isSkippedPath("artifacts/shell-regression/static/assets/styles-Y0YZqQE6.css"), true);
  assert.equal(isSkippedPath("src/styles.css"), false);
});

test("skips node_modules, .output, .pack, worktrees", () => {
  assert.equal(isSkippedPath("node_modules/foo/bar.css"), true);
  assert.equal(isSkippedPath(".output/server/styles.css"), true);
  assert.equal(isSkippedPath(".pack/bundle.css"), true);
  assert.equal(isSkippedPath(".claude/worktrees/x/src/a.css"), true);
});

test("enforce paths include src, workshops, cook-archive", () => {
  assert.equal(isEnforcePath("src/components/ade/x.css"), true);
  assert.equal(isEnforcePath("artifacts/shell-workshop/shared.css"), true);
  assert.equal(isEnforcePath("cook-archive/foo.css"), true);
  assert.equal(isEnforcePath("docs/notes.css"), false);
});

test("hardcoded hex in Layer 3 is error", () => {
  const r = classifyLine("  color: #ff00aa;", {
    file: "src/components/ade/x.css",
    lineNo: 1,
    inCustomPropDef: false,
  });
  assert.equal(r?.severity, "error");
  assert.match(r.suggestion, /--accent/);
});

test("token definition raw value is allowed", () => {
  const r = classifyLine("  --ink: oklch(0.18 0.006 70);", {
    file: "src/styles.css",
    lineNo: 1,
    inCustomPropDef: true,
  });
  assert.equal(r, null);
});

test("raw duration is warning", () => {
  const r = classifyLine("  transition: opacity 120ms linear;", {
    file: "src/components/ade/x.css",
    lineNo: 1,
    inCustomPropDef: false,
  });
  assert.equal(r?.severity, "warning");
});

test("definition allowlist for foundation, tokens, styles", () => {
  assert.equal(
    isDefinitionAllowlisted("src/components/arc/foundation.css", "  --accent: #7747ff;"),
    true,
  );
  assert.equal(
    isDefinitionAllowlisted(
      "src/components/arc/foundation.css",
      ':root[data-accent="violet"] { --accent: #7747ff; --accent-strong: #5528ce; }',
    ),
    true,
  );
  assert.equal(
    isDefinitionAllowlisted("src/tokens.css", "  --color-text: var(--foreground);"),
    true,
  );
  assert.equal(isDefinitionAllowlisted("src/styles.css", "  --ink: oklch(0.18 0.006 70);"), true);
  assert.equal(isDefinitionAllowlisted("src/components/ade/x.css", "  --local: #ff00aa;"), false);
  assert.equal(isDefinitionAllowlisted("src/styles.css", "  color: #ff00aa;"), false);
});

test("foundation single-line accent map is not a Layer 3 error", () => {
  const r = classifyLine(
    ':root[data-accent="violet"] { --accent: #7747ff; --accent-strong: #5528ce; }',
    { file: "src/components/arc/foundation.css", lineNo: 122, inCustomPropDef: false },
  );
  assert.equal(r, null);
});

test("suggestToken maps known values", () => {
  assert.equal(suggestToken("color", "#7747ff"), "--accent");
  assert.equal(suggestToken("spacing", "8px"), "--space-2");
  assert.equal(suggestToken("duration", "120ms"), "--duration-instant");
  assert.equal(suggestToken("font-weight", "500"), "--font-weight-medium");
  assert.equal(suggestToken("z-index", "1"), "--z-raised");
});

test("spacing raw px is error", () => {
  const r = classifyLine("  padding: 8px;", {
    file: "src/components/ade/x.css",
    lineNo: 1,
    inCustomPropDef: false,
  });
  assert.equal(r?.severity, "error");
  assert.match(r.suggestion, /--space-/);
});

test("transparent and var() are ignored", () => {
  assert.equal(
    classifyLine("  color: transparent;", {
      file: "src/components/ade/x.css",
      lineNo: 1,
      inCustomPropDef: false,
    }),
    null,
  );
  assert.equal(
    classifyLine("  color: var(--color-text);", {
      file: "src/components/ade/x.css",
      lineNo: 1,
      inCustomPropDef: false,
    }),
    null,
  );
});

test("border shorthand with currentColor still flags bare Npx width", () => {
  const r = classifyLine("  border: 1px solid currentColor;", {
    file: "src/components/ade/host-editor.css",
    lineNo: 85,
    inCustomPropDef: false,
  });
  assert.equal(r?.severity, "error");
  assert.match(r.violation, /border width/);
  assert.equal(r.suggestion, "--border-width-hairline");
});

test("border shorthand with transparent still flags bare Npx width", () => {
  const r = classifyLine(
    "  border-top: 1px solid color-mix(in oklab, var(--danger) 40%, transparent);",
    {
      file: "src/components/ade/host-editor.css",
      lineNo: 165,
      inCustomPropDef: false,
    },
  );
  assert.equal(r?.severity, "error");
  assert.match(r.violation, /border width/);
  assert.equal(r.suggestion, "--border-width-hairline");
});

test("border shorthand with only keyword width is not an error", () => {
  assert.equal(
    classifyLine("  border: none;", {
      file: "src/components/ade/x.css",
      lineNo: 1,
      inCustomPropDef: false,
    }),
    null,
  );
  assert.equal(
    classifyLine("  border: 0 solid transparent;", {
      file: "src/components/ade/x.css",
      lineNo: 1,
      inCustomPropDef: false,
    }),
    null,
  );
});

test("box-shadow that is only var() is not an error", () => {
  assert.equal(
    classifyLine("  box-shadow: var(--shadow-resting);", {
      file: "src/components/arc/button/button.module.css",
      lineNo: 1,
      inCustomPropDef: false,
    }),
    null,
  );
});

test("raw inset box-shadow remains an error", () => {
  const r = classifyLine("  box-shadow: inset 0 0 0 1px var(--border);", {
    file: "src/styles.css",
    lineNo: 1,
    inCustomPropDef: false,
  });
  assert.equal(r?.severity, "error");
  assert.match(r.violation, /box-shadow/);
});

test("workshop :root token-map line is not a Layer 3 error", () => {
  const r = classifyLine(":root{--ink:oklch(.18 .006 70);--shadow:0 16px 38px #2a241316}", {
    file: "artifacts/composer-reference-workshop/workshop.css",
    lineNo: 2,
    inCustomPropDef: false,
  });
  assert.equal(r, null);
});

test("border-radius var() in minified CSS does not leak peer lengths", () => {
  const r = classifyLine(
    ".opt-4 .chip{border-radius:var(--radius-sm)}.opt-4 .editor-textarea{min-height:115px}",
    {
      file: "artifacts/composer-reference-workshop/workshop.css",
      lineNo: 8,
      inCustomPropDef: false,
    },
  );
  assert.equal(r, null);
});

test("minified mid-line padding/gap is a spacing error", () => {
  const r = classifyLine(".layout { padding:12px 16px 24px; gap:12px; }", {
    file: "artifacts/agent-computer-workshop/fidelity.css",
    lineNo: 7,
    inCustomPropDef: false,
  });
  assert.equal(r?.severity, "error");
  assert.match(r.violation, /spacing/);
});

test("font shorthand with raw weight/size is an error", () => {
  const r = classifyLine(".intro h1 { font:500 22px var(--display); }", {
    file: "artifacts/agent-computer-workshop/fidelity.css",
    lineNo: 10,
    inCustomPropDef: false,
  });
  assert.equal(r?.severity, "error");
  assert.match(r.violation, /font/);
});

test("minified line with tokenized padding and raw font-size yields font-size error", () => {
  const findings = classifyLineAll(".hero{padding:var(--space-16);font-size:20px}", {
    file: "artifacts/composer-reference-workshop/workshop.css",
    lineNo: 1,
    inCustomPropDef: false,
  });
  assert.ok(findings.some((f) => f.severity === "error" && /font-size/.test(f.violation)));
});

test("minified line with two raw props yields at least two findings", () => {
  const findings = classifyLineAll(".hero{padding:12px;font-size:20px}", {
    file: "artifacts/composer-reference-workshop/workshop.css",
    lineNo: 1,
    inCustomPropDef: false,
  });
  assert.ok(findings.length >= 2);
  assert.ok(findings.some((f) => f.severity === "error" && /spacing/.test(f.violation)));
  assert.ok(findings.some((f) => f.severity === "error" && /font-size/.test(f.violation)));
});

test("minified @media block body is scanned", () => {
  const findings = classifyLineAll("@media(min-width:768px){.x{font-size:20px;padding:12px}}", {
    file: "artifacts/composer-reference-workshop/workshop.css",
    lineNo: 1,
    inCustomPropDef: false,
  });
  assert.ok(findings.length >= 2);
  assert.ok(findings.some((f) => f.severity === "error" && /font-size/.test(f.violation)));
  assert.ok(findings.some((f) => f.severity === "error" && /spacing/.test(f.violation)));
});

test("universal selector line is scanned (not treated as a comment)", () => {
  const findings = classifyLineAll("*{box-sizing:border-box}h3{font-size:20px}", {
    file: "artifacts/composer-reference-workshop/workshop.css",
    lineNo: 6,
    inCustomPropDef: false,
  });
  assert.ok(findings.some((f) => f.severity === "error" && /font-size/.test(f.violation)));
});

test("TSX rules all start at warning severity", () => {
  assert.deepEqual(
    TSX_RULES.map((rule) => [rule.id, rule.severity]),
    [
      ["tsx-arbitrary-font-size", "warning"],
      ["tsx-raw-color", "warning"],
      ["tsx-arbitrary-radius", "warning"],
      ["tsx-arbitrary-shadow", "warning"],
      ["tsx-arbitrary-z", "warning"],
      ["tsx-arbitrary-duration", "warning"],
    ],
  );
});

test("tsx-arbitrary-font-size flags px/rem literals and suggests the text scale", () => {
  const found = findingsFor(
    "tsx-arbitrary-font-size",
    '<p className="text-[13px] text-[length:0.75rem]">',
  );
  assert.equal(found.length, 2);
  assert.equal(found[0].suggestion, "text-ui");
  assert.equal(found[1].suggestion, "text-xs");
  assert.equal(found[0].severity, "warning");
  assert.equal(found[0].line, 1);
});

test("tsx-arbitrary-font-size ignores tokens and standard classes", () => {
  assert.equal(
    findingsFor("tsx-arbitrary-font-size", 'className="text-[var(--text-xs)] text-xs w-[38px]"')
      .length,
    0,
  );
});

test("tsx-raw-color flags arbitrary colour literals and inline style colours", () => {
  const found = findingsFor(
    "tsx-raw-color",
    `<div className="bg-[#7747ff] hover:text-[rgb(1,2,3)] border-t-[oklch(0.2_0.1_20)]" style={{ color: "#ff00aa" }} />`,
  );
  assert.equal(found.length, 4);
  assert.equal(found[0].suggestion, "--accent");
});

test("tsx-raw-color ignores var() colours and token classes", () => {
  assert.equal(
    findingsFor(
      "tsx-raw-color",
      `<div className="bg-[var(--color-accent)] bg-accent text-muted" style={{ color: "var(--ink)", background: "transparent" }} />`,
    ).length,
    0,
  );
});

test("tsx-arbitrary-radius flags px/rem and ignores tokens", () => {
  assert.equal(
    findingsFor("tsx-arbitrary-radius", 'className="rounded-[6px] rounded-t-[0.5rem]"').length,
    2,
  );
  assert.equal(
    findingsFor("tsx-arbitrary-radius", 'className="rounded-[var(--radius-sm)] rounded-lg"').length,
    0,
  );
});

test("tsx-arbitrary-shadow flags literal shadows and ignores var()", () => {
  assert.equal(
    findingsFor("tsx-arbitrary-shadow", 'className="shadow-[0_1px_2px_#000]"').length,
    1,
  );
  assert.equal(
    findingsFor("tsx-arbitrary-shadow", 'className="shadow-[var(--shadow-resting)] shadow-md"')
      .length,
    0,
  );
});

test("tsx-arbitrary-z flags numeric z and ignores tokens", () => {
  const found = findingsFor("tsx-arbitrary-z", 'className="z-[60]"');
  assert.equal(found.length, 1);
  assert.equal(found[0].suggestion, "--z-dropdown");
  assert.equal(findingsFor("tsx-arbitrary-z", 'className="z-50 z-[var(--z-modal)]"').length, 0);
});

test("tsx-arbitrary-duration flags ms/s and ignores tokens", () => {
  assert.equal(
    findingsFor("tsx-arbitrary-duration", 'className="duration-[240ms] duration-[0.3s]"').length,
    2,
  );
  assert.equal(
    findingsFor(
      "tsx-arbitrary-duration",
      'className="duration-200 duration-[var(--duration-fast)]"',
    ).length,
    0,
  );
});

test("layout arbitrary values and (--token) shorthand are not flagged", () => {
  const text =
    'className="w-[38px] h-[120px] top-[12px] translate-x-[4px] grid-cols-[1fr_2fr] inset-[0] bg-(--brand) text-(--x) rounded-(--r)"';
  assert.equal(tsxFindings(text).all.length, 0);
});

test("TSX error-severity rule counts as an error", () => {
  const rules = TSX_RULES.map((rule) =>
    rule.id === "tsx-raw-color" ? { ...rule, severity: "error" } : rule,
  );
  const { errors, warnings } = tsxFindings('className="bg-[#7747ff]"', rules);
  assert.equal(errors.length, 1);
  assert.equal(warnings.length, 0);
  assert.equal(errors[0].severity, "error");
});

test("isTsxSourceFile covers src .ts/.tsx and skips tests and declarations", () => {
  assert.equal(isTsxSourceFile("src/components/ade/Shell.tsx"), true);
  assert.equal(isTsxSourceFile("src/lib/util.ts"), true);
  assert.equal(isTsxSourceFile("src/components/ade/Shell.test.tsx"), false);
  assert.equal(isTsxSourceFile("src/types.d.ts"), false);
  assert.equal(isTsxSourceFile("scripts/token-audit.js"), false);
});

test("countTsxByRule reports zero for rules with no findings", () => {
  const counts = countTsxByRule(findingsFor("tsx-arbitrary-z", 'className="z-[60]"'));
  assert.equal(counts["tsx-arbitrary-z"], 1);
  assert.equal(counts["tsx-raw-color"], 0);
  assert.equal(Object.keys(counts).length, TSX_RULES.length);
});

test("auditFiles scans src TSX but not test files", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-audit-"));
  try {
    fs.mkdirSync(path.join(root, "src"));
    fs.writeFileSync(path.join(root, "src", "Thing.tsx"), '<p className="text-[13px]" />\n');
    fs.writeFileSync(path.join(root, "src", "Thing.test.tsx"), '<p className="text-[13px]" />\n');
    const { warnings } = auditFiles(root);
    const tsx = warnings.filter((f) => f.rule);
    assert.equal(tsx.length, 1);
    assert.equal(tsx[0].file, "src/Thing.tsx");
    assert.equal(tsx[0].rule, "tsx-arbitrary-font-size");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
