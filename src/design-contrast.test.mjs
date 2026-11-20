import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Regression check: text colours in styles.css must meet WCAG AA (4.5:1)
// on the main surfaces in both light and dark themes.

const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

// Returns the text between the `{` at openIndex and its matching `}`.
function blockBody(source, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex + 1, i);
    }
  }
  throw new Error("Unbalanced braces in styles.css");
}

// Finds the top-level block whose header matches `header` (a RegExp) and
// that satisfies `accept(body)`. Returns the body text or null.
function findBlock(header, accept) {
  const pattern = new RegExp(header.source, "gm");
  let match;
  while ((match = pattern.exec(css)) !== null) {
    const openIndex = css.indexOf("{", match.index);
    const body = blockBody(css, openIndex);
    if (accept(body)) return body;
  }
  return null;
}

// Parses `--name: oklch(L C H);` declarations. Anything else (var(), color-mix,
// alpha slashes) is ignored.
function parseOklchTokens(body) {
  const tokens = new Map();
  const declaration = /--([\w-]+):\s*oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)\s*;/g;
  let match;
  while ((match = declaration.exec(body)) !== null) {
    tokens.set(`--${match[1]}`, [Number(match[2]), Number(match[3]), Number(match[4])]);
  }
  return tokens;
}

const themes = {
  light: parseOklchTokens(findBlock(/^:root \{/, (body) => body.includes("--paper:")) ?? ""),
  dark: parseOklchTokens(findBlock(/^:root\[data-theme="dark"\] \{/, () => true) ?? ""),
};

const TEXT_ROLES = ["--ink", "--text-secondary", "--dim"];
const SURFACE_ROLES = ["--paper", "--panel", "--surface-muted"];
const MIN_RATIO = 4.5;

function resolve(theme, name) {
  const color = themes[theme].get(name);
  if (!color) {
    throw new Error(
      `${name} is missing or not a plain oklch(...) in the ${theme} theme block of styles.css`,
    );
  }
  return color;
}

// OKLab -> linear sRGB, clamped to [0, 1].
function oklchToLinearSrgb([L, C, h]) {
  const hr = (h * Math.PI) / 180,
    a = C * Math.cos(hr),
    b = C * Math.sin(hr);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((v) => Math.min(1, Math.max(0, v)));
}

const luminance = (c) => {
  const [r, g, b] = oklchToLinearSrgb(c);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (x, y) => {
  const a = luminance(x),
    b = luminance(y);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

for (const theme of Object.keys(themes)) {
  for (const text of TEXT_ROLES) {
    for (const surface of SURFACE_ROLES) {
      test(`${theme}: ${text} on ${surface} meets ${MIN_RATIO}:1`, () => {
        const ratio = contrast(resolve(theme, text), resolve(theme, surface));
        assert.ok(
          ratio >= MIN_RATIO,
          `${theme} ${text} on ${surface} is ${ratio.toFixed(2)}:1 (needs ${MIN_RATIO}:1)`,
        );
      });
    }
  }
}
