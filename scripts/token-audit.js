#!/usr/bin/env node
/**
 * Token audit — flag Layer 3 hardcoded visual values in CSS and TSX/TS source; suggest Layer 2 tokens.
 * Exit 1 when any errors remain on enforce paths.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SKIP_PREFIXES = [
  "node_modules/",
  ".output/",
  ".pack/",
  ".claude/worktrees/",
  "artifacts/shell-regression/static/assets/",
];

const DEFINITION_ALLOWLIST_FILES = new Set([
  "src/components/arc/foundation.css",
  "src/tokens.css",
  "src/styles.css",
]);

const CUSTOM_PROP_DEF = /^\s*--[\w-]+\s*:/;

/** @type {Record<string, Array<[string, string]>>} */
const SUGGESTION_MAPS = {
  color: [
    ["#7747ff", "--accent"],
    ["#5528ce", "--accent-strong"],
    ["#0562ef", "--teal-deep"],
    ["#f15f55", "--danger"],
    ["#0db879", "--success"],
    ["#f3ad20", "--warning"],
  ],
  spacing: [
    ["0", "--space-0"],
    ["0.25rem", "--space-1"],
    [".25rem", "--space-1"],
    ["4px", "--space-1"],
    ["0.5rem", "--space-2"],
    [".5rem", "--space-2"],
    ["8px", "--space-2"],
    ["0.75rem", "--space-3"],
    [".75rem", "--space-3"],
    ["12px", "--space-3"],
    ["1rem", "--space-4"],
    ["16px", "--space-4"],
    ["1.25rem", "--space-5"],
    ["20px", "--space-5"],
    ["1.5rem", "--space-6"],
    ["24px", "--space-6"],
    ["2rem", "--space-8"],
    ["32px", "--space-8"],
    ["2.5rem", "--space-10"],
    ["40px", "--space-10"],
    ["3rem", "--space-12"],
    ["48px", "--space-12"],
    ["4rem", "--space-16"],
    ["64px", "--space-16"],
    ["5rem", "--space-20"],
    ["80px", "--space-20"],
    ["6rem", "--space-24"],
    ["96px", "--space-24"],
  ],
  radius: [
    ["0.375rem", "--radius-xs"],
    ["0.5rem", "--radius-sm"],
    ["0.625rem", "--radius-control"],
    ["0.75rem", "--radius-lg"],
    ["1rem", "--radius-panel"],
    ["1.125rem", "--radius-control"],
    ["1.25rem", "--radius-surface"],
    ["1.625rem", "--radius-panel"],
    ["2.125rem", "--radius-surface"],
    ["9999px", "--radius-pill"],
    ["50%", "50% (layout geometry — ok)"],
  ],
  duration: [
    ["120ms", "--duration-instant"],
    ["0.12s", "--duration-instant"],
    ["160ms", "--duration-fast"],
    ["0.16s", "--duration-fast"],
    ["240ms", "--duration-standard"],
    ["0.24s", "--duration-standard"],
    ["480ms", "--duration-considered"],
    ["0.48s", "--duration-considered"],
    ["580ms", "--duration-spring"],
    ["0.58s", "--duration-spring"],
  ],
  "z-index": [
    ["1", "--z-raised"],
    ["50", "--z-dropdown"],
    ["2147483647", "--z-veil"],
  ],
  "font-weight": [
    ["400", "--font-weight-regular"],
    ["500", "--font-weight-medium"],
    ["600", "--font-weight-semibold"],
  ],
  "font-size": [
    ["0.75rem", "--text-xs"],
    [".75rem", "--text-xs"],
    ["12px", "--text-xs"],
    ["0.875rem", "--text-sm"],
    [".875rem", "--text-sm"],
    ["14px", "--text-sm"],
    ["1rem", "--text-base"],
    ["16px", "--text-base"],
    ["1.125rem", "--text-lg"],
    ["18px", "--text-lg"],
    ["1.375rem", "--text-xl"],
    ["22px", "--text-xl"],
    ["1.75rem", "--text-2xl"],
    ["28px", "--text-2xl"],
    ["2.25rem", "--text-3xl"],
    ["36px", "--text-3xl"],
    ["3.25rem", "--text-4xl"],
    ["52px", "--text-4xl"],
    ["4.5rem", "--text-5xl"],
    ["72px", "--text-5xl"],
  ],
  "border-width": [
    ["1px", "--border-width-hairline"],
    ["2px", "--border-width-thick"],
    ["3px", "--border-width-heavy"],
  ],
  shadow: [
    ["resting", "--shadow-resting"],
    ["raised", "--shadow-raised"],
    ["floating", "--shadow-floating"],
  ],
};

const IGNORE_KEYWORDS = /\b(transparent|currentColor|none|inherit|initial|unset)\b/i;

/** Tailwind text-size scale (px → class) for `text-[Npx]` suggestions. */
const TSX_FONT_SIZE_SCALE = [
  [9, "text-3xs"],
  [10, "text-2xs"],
  [11, "text-caption"],
  [12, "text-xs"],
  [13, "text-ui"],
  [14, "text-sm"],
  [16, "text-base"],
  [18, "text-lg"],
  [22, "text-xl"],
  [28, "text-2xl"],
];

/**
 * Hardcoded values in TSX/TS source (regex over text, no JSX parsing).
 * Set `severity` to "error" to make a rule count toward the exit code.
 * `describe(match)` returns `{ value, suggestion }`, or null to skip a match.
 * @type {Array<{ id: string, severity: "error" | "warning", patterns: RegExp[], describe: (m: RegExpMatchArray) => { value: string, suggestion: string } | null }>}
 */
export const TSX_RULES = [
  {
    id: "tsx-arbitrary-font-size",
    severity: "warning",
    patterns: [/(?<![\w-])text-\[(?:length:)?(\d*\.?\d+)(px|rem)\]/g],
    describe: (m) => {
      const px = Number(m[1]) * (m[2] === "rem" ? 16 : 1);
      let best = TSX_FONT_SIZE_SCALE[0];
      for (const entry of TSX_FONT_SIZE_SCALE) {
        if (Math.abs(entry[0] - px) < Math.abs(best[0] - px)) best = entry;
      }
      const exact = best[0] === px;
      return {
        value: m[0],
        suggestion: exact ? best[1] : `${best[1]} (nearest to ${px}px)`,
      };
    },
  },
  {
    id: "tsx-raw-color",
    severity: "warning",
    patterns: [
      /(?<![\w-])(?:bg|text|border|ring|ring-offset|fill|stroke|from|to|via|outline|shadow|decoration|divide|caret|accent|placeholder)(?:-[trblxyse])?-\[((?:#[0-9a-fA-F]{3,8}\b|(?:rgba?|hsla?|oklch)\()[^\]]*)\]/g,
      /(?<![\w-])(?:color|background|backgroundColor|borderColor|fill|stroke)\s*:\s*["'`]((?:#[0-9a-fA-F]{3,8}\b|(?:rgba?|hsla?|oklch)\()[^"'`]*)["'`]/g,
    ],
    describe: (m) => ({ value: m[0], suggestion: suggestToken("color", m[1]) }),
  },
  {
    id: "tsx-arbitrary-radius",
    severity: "warning",
    patterns: [/(?<![\w-])rounded(?:-[trblse]{1,2})?-\[(\d*\.?\d+)(px|rem)\]/g],
    describe: (m) => ({ value: m[0], suggestion: suggestToken("radius", `${m[1]}${m[2]}`) }),
  },
  {
    id: "tsx-arbitrary-shadow",
    severity: "warning",
    patterns: [/(?<![\w-])shadow-\[([^\]]*)\]/g],
    describe: (m) => {
      // Only a literal (digits, hex, colour function) outside var() is a raw shadow.
      const literal = m[1].replace(/var\([^)]*\)/g, "");
      if (!/[\d#]|(?:rgba?|hsla?|oklch)\(/i.test(literal)) return null;
      return {
        value: m[0],
        suggestion: "--shadow-resting | --shadow-raised | --shadow-floating",
      };
    },
  },
  {
    id: "tsx-arbitrary-z",
    severity: "warning",
    patterns: [/(?<![\w-])z-\[(-?\d+)\]/g],
    describe: (m) => ({ value: m[0], suggestion: suggestToken("z-index", m[1]) }),
  },
  {
    id: "tsx-arbitrary-duration",
    severity: "warning",
    patterns: [/(?<![\w-])duration-\[(\d*\.?\d+)(ms|s)\]/g],
    describe: (m) => ({ value: m[0], suggestion: suggestToken("duration", `${m[1]}${m[2]}`) }),
  },
];

/**
 * @param {string} relPath
 */
export function isSkippedPath(relPath) {
  const normalized = relPath.replaceAll("\\", "/");
  return SKIP_PREFIXES.some(
    (prefix) => normalized === prefix.slice(0, -1) || normalized.startsWith(prefix),
  );
}

/**
 * @param {string} relPath
 */
export function isEnforcePath(relPath) {
  const normalized = relPath.replaceAll("\\", "/");
  if (isSkippedPath(normalized)) return false;
  if (normalized.startsWith("src/") && normalized.endsWith(".css")) return true;
  if (/^artifacts\/[^/]+-workshop\//.test(normalized) && normalized.endsWith(".css")) return true;
  if (normalized.startsWith("cook-archive/") && normalized.endsWith(".css")) return true;
  return false;
}

/**
 * @param {string} relPath
 * @param {string} line
 */
export function isDefinitionAllowlisted(relPath, line) {
  const normalized = relPath.replaceAll("\\", "/");
  if (!DEFINITION_ALLOWLIST_FILES.has(normalized)) return false;
  if (CUSTOM_PROP_DEF.test(line)) return true;
  // Single-line token maps: `:root[data-accent="violet"] { --accent: #7747ff; … }`
  if (
    (/^\s*:root(?:\[[^\]]*\])*\s*\{/.test(line) || /^\s*@theme\b[^{]*\{/.test(line)) &&
    /--[\w-]+\s*:/.test(line)
  ) {
    return true;
  }
  return false;
}

/**
 * @param {string} kind
 * @param {string} rawValue
 */
export function suggestToken(kind, rawValue) {
  const raw = String(rawValue).trim().toLowerCase();
  const map = SUGGESTION_MAPS[kind];
  if (!map) return `var(--token-for-${kind})`;

  for (const [value, token] of map) {
    if (value.toLowerCase() === raw) return token;
  }

  // Nearest numeric for spacing / duration / z-index / font-weight / border-width / font-size
  if (
    [
      "spacing",
      "duration",
      "z-index",
      "font-weight",
      "border-width",
      "font-size",
      "radius",
    ].includes(kind)
  ) {
    const target = parseCssLength(raw);
    if (target != null) {
      let best = null;
      let bestDist = Infinity;
      for (const [value, token] of map) {
        const n = parseCssLength(value);
        if (n == null) continue;
        const dist = Math.abs(n - target);
        if (dist < bestDist) {
          bestDist = dist;
          best = token;
        }
      }
      if (best) return best;
    }
  }

  if (kind === "color") {
    if (raw.includes("7747ff") || raw === "#7747ff") return "--accent";
    return "--accent";
  }
  if (kind === "shadow") return "--shadow-resting";
  return `--${kind.replaceAll(" ", "-")}-token`;
}

/**
 * @param {string} value
 * @returns {number | null} normalized to px when possible (rem≈16px, ms as-is, unitless as-is)
 */
function parseCssLength(value) {
  const v = value.trim().toLowerCase();
  const m = /^(-?\d*\.?\d+)(px|rem|em|ms|s)?$/.exec(v);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2] || "";
  if (unit === "rem" || unit === "em") return n * 16;
  if (unit === "s") return n * 1000;
  return n;
}

/**
 * Strip comments and var(...)/url(...) so nested raw values inside them are ignored.
 * @param {string} line
 */
function sanitizeForScan(line) {
  let s = line.replace(/\/\*[\s\S]*?\*\//g, " ");
  s = s.replace(/\/\/.*$/, " ");
  // Remove var(...) and url(...) including nested parens (simple depth walk)
  s = stripFnCalls(s, "var");
  s = stripFnCalls(s, "url");
  return s;
}

/**
 * @param {string} input
 * @param {string} name
 */
function stripFnCalls(input, name) {
  const lower = input.toLowerCase();
  const needle = `${name}(`;
  let out = "";
  let i = 0;
  while (i < input.length) {
    const idx = lower.indexOf(needle, i);
    if (idx === -1) {
      out += input.slice(i);
      break;
    }
    out += input.slice(i, idx);
    let depth = 0;
    let j = idx + needle.length - 1;
    for (; j < input.length; j++) {
      if (input[j] === "(") depth++;
      else if (input[j] === ")") {
        depth--;
        if (depth === 0) {
          j++;
          break;
        }
      }
    }
    out += " ";
    i = j;
  }
  return out;
}

/**
 * @typedef {{ severity: "error" | "warning", violation: string, suggestion: string }} Finding
 */

/**
 * First finding only — keeps existing tests / callers stable.
 * @param {string} line
 * @param {{ file: string, lineNo: number, inCustomPropDef?: boolean }} ctx
 * @returns {Finding | null}
 */
export function classifyLine(line, ctx) {
  const all = classifyLineAll(line, ctx);
  return all[0] ?? null;
}

/**
 * Every audited raw property occurrence on the line (minified peers included).
 * @param {string} line
 * @param {{ file: string, lineNo: number, inCustomPropDef?: boolean }} ctx
 * @returns {Finding[]}
 */
export function classifyLineAll(line, ctx) {
  /** @type {Finding[]} */
  const findings = [];
  const trimmed = line.trim();
  // Skip blank / comment lines only — do not treat universal selector `*{…}` as a comment.
  if (
    !trimmed ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith("//") ||
    /^\*(?:\s|\/|$)/.test(trimmed)
  ) {
    return findings;
  }

  if (ctx.inCustomPropDef || isDefinitionAllowlisted(ctx.file, line)) {
    return findings;
  }

  // Local custom-prop definitions in non-allowlisted files still define tokens —
  // treat definition lines as allowed (raw values belong in definitions).
  if (CUSTOM_PROP_DEF.test(line)) {
    return findings;
  }

  // Workshop / archive single-line `:root` / `@theme` token maps (embedded Layer 1).
  if (
    (/^\s*:root(?:\[[^\]]*\])*\s*\{/.test(line) || /^\s*@theme\b[^{]*\{/.test(line)) &&
    /--[\w-]+\s*:/.test(line)
  ) {
    return findings;
  }

  // At-rule conditions (e.g. @supports (color: oklch(...))) are not Layer 3 values.
  // Minified `@media(...){ …decls… }` still needs its block body scanned.
  let scanSource = line;
  if (/^@(?:supports|media|import|charset|namespace)\b/i.test(trimmed)) {
    const brace = trimmed.indexOf("{");
    if (brace === -1) return findings;
    scanSource = trimmed.slice(brace);
  }

  const scan = sanitizeForScan(scanSource);
  if (!scan.trim()) return findings;

  // Property decls may appear after `{` / `;` in minified CSS, not only at line start.
  const propAt = "(?:^|[;{])\\s*";

  // Duration warnings on motion props — collect each non-zero duration on the line.
  const isMotionProp = new RegExp(
    `${propAt}(transition|animation|transition-duration|animation-duration)\\b`,
    "i",
  ).test(scan);
  if (isMotionProp) {
    for (const durationMatch of scan.matchAll(/(?<![\w-])(\d*\.?\d+)(ms|s)(?![\w-])/gi)) {
      const raw = `${durationMatch[1]}${durationMatch[2]}`;
      if (raw !== "0s" && raw !== "0ms" && Number(durationMatch[1]) !== 0) {
        findings.push({
          severity: "warning",
          violation: `raw duration ${raw}`,
          suggestion: suggestToken("duration", raw),
        });
      }
    }
  }

  // Colors — every hex / function call left after var()/url strip
  for (const colorMatch of scan.matchAll(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch)\s*\(/gi)) {
    const raw = colorMatch[0];
    findings.push({
      severity: "error",
      violation: `hardcoded color ${raw}`,
      suggestion: suggestToken("color", raw),
    });
  }

  // font-weight number (mid-line / minified) — every occurrence
  for (const fw of scan.matchAll(new RegExp(`${propAt}font-weight\\s*:\\s*(\\d+)\\b`, "gi"))) {
    findings.push({
      severity: "error",
      violation: `raw font-weight ${fw[1]}`,
      suggestion: suggestToken("font-weight", fw[1]),
    });
  }

  // font-size raw length (stop at ; or } so minified peers are not scanned)
  for (const fsMatch of scan.matchAll(new RegExp(`${propAt}font-size\\s*:\\s*([^;}]*)`, "gi"))) {
    const value = fsMatch[1].trim();
    if (
      value &&
      !IGNORE_KEYWORDS.test(value) &&
      /^(?:clamp\s*\()?[\d.]+\s*(px|rem|em)\b/i.test(value)
    ) {
      const raw = value.match(/[\d.]+\s*(?:px|rem|em)/i)?.[0] ?? value;
      findings.push({
        severity: "error",
        violation: `raw font-size ${raw}`,
        suggestion: suggestToken("font-size", raw.replace(/\s+/g, "")),
      });
    }
  }

  // font shorthand — flag embedded raw weight or size (var()/url already stripped)
  for (const fontShort of scan.matchAll(new RegExp(`${propAt}font\\s*:\\s*([^;}]*)`, "gi"))) {
    const value = fontShort[1].trim();
    if (value && !IGNORE_KEYWORDS.test(value)) {
      const weight = value.match(/(?<![\d.])([1-9]00)\b/);
      if (weight) {
        findings.push({
          severity: "error",
          violation: `raw font-weight ${weight[1]} (in font shorthand)`,
          suggestion: suggestToken("font-weight", weight[1]),
        });
        continue;
      }
      const size = value.match(/(?<![\w-])(\d*\.?\d+)\s*(px|rem|em)\b/i);
      if (size && Number(size[1]) !== 0) {
        const raw = `${size[1]}${size[2]}`;
        findings.push({
          severity: "error",
          violation: `raw font-size ${raw} (in font shorthand)`,
          suggestion: suggestToken("font-size", raw.replace(/\s+/g, "")),
        });
      }
    }
  }

  // z-index number — every occurrence
  for (const z of scan.matchAll(new RegExp(`${propAt}z-index\\s*:\\s*(-?\\d+)\\b`, "gi"))) {
    findings.push({
      severity: "error",
      violation: `raw z-index ${z[1]}`,
      suggestion: suggestToken("z-index", z[1]),
    });
  }

  // box-shadow — empty after var() strip means the value was tokenized
  for (const shadow of scan.matchAll(new RegExp(`${propAt}box-shadow\\s*:\\s*([^;}]*)`, "gi"))) {
    const value = shadow[1].trim();
    if (value && !/^none$/i.test(value) && !IGNORE_KEYWORDS.test(value)) {
      findings.push({
        severity: "error",
        violation: "raw box-shadow",
        suggestion: suggestToken("shadow", "resting"),
      });
    }
  }

  // border-radius (stop at ; or } — minified peers must not leak into the value)
  for (const radius of scan.matchAll(new RegExp(`${propAt}border-radius\\s*:\\s*([^;}]*)`, "gi"))) {
    const value = radius[1].trim();
    if (
      value &&
      !IGNORE_KEYWORDS.test(value) &&
      !/^50%$/.test(value) &&
      !/^9999px$/i.test(value) &&
      /^[\d.]+\s*(px|rem|em|%)/i.test(value)
    ) {
      const raw = value.match(/[\d.]+\s*(?:px|rem|em|%)/i)?.[0] ?? value;
      findings.push({
        severity: "error",
        violation: `raw border-radius ${raw}`,
        suggestion: suggestToken("radius", raw.replace(/\s+/g, "")),
      });
    }
  }

  // border-width / border: Npx — every occurrence
  for (const borderWidth of scan.matchAll(
    new RegExp(`${propAt}border(?:-\\w+)*-width\\s*:\\s*([^;}]*)`, "gi"),
  )) {
    const value = borderWidth[1].trim();
    if (
      !/^0(?:px)?$/i.test(value) &&
      !IGNORE_KEYWORDS.test(value) &&
      /^[\d.]+\s*px\b/i.test(value)
    ) {
      const raw = value.match(/[\d.]+\s*px/i)?.[0] ?? value;
      findings.push({
        severity: "error",
        violation: `raw border-width ${raw}`,
        suggestion: suggestToken("border-width", raw.replace(/\s+/g, "")),
      });
    }
  }
  for (const borderShorthand of scan.matchAll(
    new RegExp(`${propAt}border(?:-(?:top|right|bottom|left))?\\s*:\\s*([^;}]*)`, "gi"),
  )) {
    // Skip if this match is actually border-*-width or border-radius (already handled)
    const matchedProp = borderShorthand[0];
    if (/border(?:-\w+)*-width/i.test(matchedProp) || /border-radius/i.test(matchedProp)) continue;
    const value = borderShorthand[1].trim();
    // Flag bare non-zero Npx widths even when the value also contains
    // currentColor / transparent / none (those keywords are not widths).
    const px = value.match(/^(?!0(?:px)?\b)(\d*\.?\d+)\s*px\b/i);
    if (px && Number(px[1]) !== 0) {
      const raw = `${px[1]}px`;
      findings.push({
        severity: "error",
        violation: `raw border width ${raw}`,
        suggestion: suggestToken("border-width", raw),
      });
    }
  }

  // spacing: padding|margin|gap|inset|top|right|bottom|left|row-gap|column-gap — every prop
  const spacingRe = new RegExp(
    `${propAt}(padding|margin|gap|row-gap|column-gap|inset|top|right|bottom|left|padding-\\w+|margin-\\w+)\\s*:\\s*([^;}]*)`,
    "gi",
  );
  for (const spacingProp of scan.matchAll(spacingRe)) {
    const value = spacingProp[2].trim();
    if (!IGNORE_KEYWORDS.test(value)) {
      // Allow bare 0
      const lengths = [...value.matchAll(/(?<![\w-])(-?\d*\.?\d+)(px|rem|em)\b/gi)];
      const nonZero = lengths.filter((m) => Number(m[1]) !== 0);
      if (nonZero.length > 0) {
        const raw = `${nonZero[0][1]}${nonZero[0][2]}`;
        findings.push({
          severity: "error",
          violation: `raw spacing ${raw}`,
          suggestion: suggestToken("spacing", raw.toLowerCase()),
        });
      }
    }
  }

  return findings;
}

/**
 * @param {string} rootDir
 * @returns {{ errors: object[], warnings: object[], skipped: string[] }}
 */
export function auditFiles(rootDir) {
  const errors = [];
  const warnings = [];
  const skipped = [];

  /**
   * @param {string} dir
   */
  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const rel = path.relative(rootDir, abs).replaceAll("\\", "/");
      if (entry.isDirectory()) {
        if (
          entry.name === "node_modules" ||
          entry.name === ".output" ||
          entry.name === ".pack" ||
          entry.name === ".git" ||
          (entry.name === "worktrees" && rel.includes(".claude/"))
        ) {
          skipped.push(rel + "/");
          continue;
        }
        if (isSkippedPath(rel + "/") || isSkippedPath(rel)) {
          skipped.push(rel + "/");
          continue;
        }
        walk(abs);
        continue;
      }
      if (isTsxSourceFile(rel)) {
        scanTsxFile(abs, rel, errors, warnings);
        continue;
      }
      if (!entry.name.endsWith(".css")) continue;
      if (isSkippedPath(rel)) {
        skipped.push(rel);
        continue;
      }
      scanFile(abs, rel, errors, warnings);
    }
  }

  walk(rootDir);
  return { errors, warnings, skipped };
}

/**
 * @param {string} abs
 * @param {string} rel
 * @param {object[]} errors
 * @param {object[]} warnings
 */
function scanFile(abs, rel, errors, warnings) {
  const enforce = isEnforcePath(rel);
  const allowlistedFile = DEFINITION_ALLOWLIST_FILES.has(rel);
  let text;
  try {
    text = fs.readFileSync(abs, "utf8");
  } catch {
    return;
  }
  const lines = text.split(/\r?\n/);
  let inBlockComment = false;
  /** Brace depth inside `:root` / `@theme` token-map blocks (allowlisted files only) */
  let tokenMapDepth = 0;
  /** Brace depth inside `@font-face` (descriptors are not Layer 3) */
  let fontFaceDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const lineNo = i + 1;

    if (inBlockComment) {
      const end = line.indexOf("*/");
      if (end === -1) continue;
      line = line.slice(end + 2);
      inBlockComment = false;
    }
    const startComment = line.indexOf("/*");
    if (startComment !== -1) {
      const end = line.indexOf("*/", startComment + 2);
      if (end === -1) {
        line = line.slice(0, startComment);
        inBlockComment = true;
      } else {
        line = line.slice(0, startComment) + " " + line.slice(end + 2);
      }
    }

    // Track @font-face blocks — font-weight ranges / src are face descriptors, not Layer 3.
    if (fontFaceDepth === 0 && /^\s*@font-face\b/i.test(line)) {
      for (const ch of line) {
        if (ch === "{") fontFaceDepth++;
        else if (ch === "}") fontFaceDepth--;
      }
      if (fontFaceDepth < 0) fontFaceDepth = 0;
      continue;
    }
    if (fontFaceDepth > 0) {
      for (const ch of line) {
        if (ch === "{") fontFaceDepth++;
        else if (ch === "}") fontFaceDepth--;
      }
      if (fontFaceDepth < 0) fontFaceDepth = 0;
      continue;
    }

    let inCustomPropDef = false;
    if (allowlistedFile) {
      // Entire `:root` / `@theme` custom-prop maps are definition-allowlisted.
      // Do not treat descendant selectors like `:root[data-theme-switching] *` as maps.
      const opensTokenMap =
        tokenMapDepth === 0 &&
        (/^\s*:root(?:\[[^\]]*\])*\s*\{/.test(line) || /^\s*@theme\b[^{]*\{/.test(line));
      if (opensTokenMap) {
        tokenMapDepth = 0;
        let started = false;
        for (const ch of line) {
          if (ch === "{") {
            tokenMapDepth++;
            started = true;
          } else if (ch === "}" && started) {
            tokenMapDepth--;
          }
        }
        if (tokenMapDepth < 0) tokenMapDepth = 0;
        inCustomPropDef = true;
      } else if (tokenMapDepth > 0) {
        inCustomPropDef = true;
        for (const ch of line) {
          if (ch === "{") tokenMapDepth++;
          else if (ch === "}") tokenMapDepth--;
        }
        if (tokenMapDepth < 0) tokenMapDepth = 0;
      } else if (isDefinitionAllowlisted(rel, line)) {
        inCustomPropDef = true;
      }
    }

    const results = classifyLineAll(line, { file: rel, lineNo, inCustomPropDef });
    for (const result of results) {
      const finding = {
        file: rel,
        line: lineNo,
        severity: result.severity,
        violation: result.violation,
        suggestion: result.suggestion,
        enforce,
      };

      // Errors only count toward exit when on enforce paths; still report all scan findings
      if (result.severity === "error") {
        if (enforce) errors.push(finding);
        else
          warnings.push({
            ...finding,
            severity: "warning",
            violation: `[non-enforce] ${result.violation}`,
          });
      } else {
        warnings.push(finding);
      }
    }
  }
}

/**
 * TSX/TS source under src/, excluding tests and declaration files.
 * @param {string} relPath
 */
export function isTsxSourceFile(relPath) {
  const normalized = relPath.replaceAll("\\", "/");
  if (isSkippedPath(normalized) || !normalized.startsWith("src/")) return false;
  const base = path.posix.basename(normalized);
  if (base.includes(".test.") || base.endsWith(".d.ts")) return false;
  return base.endsWith(".tsx") || base.endsWith(".ts");
}

/**
 * Apply TSX_RULES to source text; findings are routed like CSS findings.
 * @param {string} relPath
 * @param {string} text
 * @param {object[]} errors
 * @param {object[]} warnings
 * @param {typeof TSX_RULES} [rules]
 */
export function scanTsxText(relPath, text, errors, warnings, rules = TSX_RULES) {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    for (const rule of rules) {
      for (const pattern of rule.patterns) {
        for (const match of lines[i].matchAll(pattern)) {
          const described = rule.describe(match);
          if (!described) continue;
          const finding = {
            file: relPath,
            line: i + 1,
            severity: rule.severity,
            violation: `${rule.id} ${described.value}`,
            suggestion: described.suggestion,
            enforce: true,
            rule: rule.id,
          };
          if (rule.severity === "error") errors.push(finding);
          else warnings.push(finding);
        }
      }
    }
  }
}

/**
 * @param {string} abs
 * @param {string} rel
 * @param {object[]} errors
 * @param {object[]} warnings
 */
function scanTsxFile(abs, rel, errors, warnings) {
  let text;
  try {
    text = fs.readFileSync(abs, "utf8");
  } catch {
    return;
  }
  scanTsxText(rel, text, errors, warnings);
}

/**
 * Finding count per TSX rule id (zero for rules with no findings).
 * @param {{ rule?: string }[]} findings
 * @returns {Record<string, number>}
 */
export function countTsxByRule(findings) {
  const counts = Object.fromEntries(TSX_RULES.map((rule) => [rule.id, 0]));
  for (const f of findings) {
    if (f.rule && Object.hasOwn(counts, f.rule)) counts[f.rule]++;
  }
  return counts;
}

/**
 * @param {{ file: string, line: number, severity: string, violation: string, suggestion: string }} f
 */
function formatFinding(f) {
  return `${f.file}:${f.line}: ${f.severity}: ${f.violation} → ${f.suggestion}`;
}

function main() {
  const rootDir = process.cwd();
  const { errors, warnings } = auditFiles(rootDir);
  for (const f of [...errors, ...warnings]) {
    console.log(formatFinding(f));
  }
  if (errors.length === 0 && warnings.length === 0) {
    console.log("token-audit: no findings");
  } else {
    console.error(`token-audit: ${errors.length} error(s), ${warnings.length} warning(s)`);
  }
  const tsxCounts = countTsxByRule([...errors, ...warnings]);
  console.error(
    `token-audit tsx: ${Object.entries(tsxCounts)
      .map(([id, n]) => `${id}=${n}`)
      .join(", ")}`,
  );
  process.exit(errors.length ? 1 : 0);
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main();
}
