import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyLine,
  classifyLineAll,
  suggestToken,
  isSkippedPath,
  isEnforcePath,
  isDefinitionAllowlisted,
} from "./token-audit.js";

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
  assert.match(r.suggestion, /--color-/);
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
  assert.equal(isDefinitionAllowlisted("src/tokens.css", "  --color-text: var(--foreground);"), true);
  assert.equal(isDefinitionAllowlisted("src/styles.css", "  --ink: oklch(0.18 0.006 70);"), true);
  assert.equal(
    isDefinitionAllowlisted("src/components/ade/x.css", "  --local: #ff00aa;"),
    false,
  );
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
  assert.equal(suggestToken("color", "#7747ff"), "--color-accent");
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
  const r = classifyLine(
    ":root{--ink:oklch(.18 .006 70);--shadow:0 16px 38px #2a241316}",
    { file: "artifacts/composer-reference-workshop/workshop.css", lineNo: 2, inCustomPropDef: false },
  );
  assert.equal(r, null);
});

test("border-radius var() in minified CSS does not leak peer lengths", () => {
  const r = classifyLine(
    ".opt-4 .chip{border-radius:var(--radius-sm)}.opt-4 .editor-textarea{min-height:115px}",
    { file: "artifacts/composer-reference-workshop/workshop.css", lineNo: 8, inCustomPropDef: false },
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
  const findings = classifyLineAll(
    ".hero{padding:var(--space-16);font-size:20px}",
    { file: "artifacts/composer-reference-workshop/workshop.css", lineNo: 1, inCustomPropDef: false },
  );
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
