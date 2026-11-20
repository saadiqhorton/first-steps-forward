# Typography

Type scale, families, leading, tracking, and weights. Font families exist as Arc/ADE names (`--font-display` / `--font-body` / `--font-mono`) and the Layer 2 alias `--font-family-mono`. Prefer these names in new component CSS.

Sources: type scale / leading / tracking in `src/components/arc/foundation.css`; ADE overrides `--tracking-body: 0` and font face bindings in `src/styles.css`; the Tailwind type-scale utilities (`text-3xs` … `text-2xl`) in the `@theme` block of `src/styles.css`; weights and `--font-family-mono` in `src/tokens.css`.

## Type scale

Use these Tailwind utilities for font size. They set font-size only (no line-height).

| Utility | Size | When to use |
| --- | --- | --- |
| `text-3xs` | 9px | Workshop mono / tiny chrome labels |
| `text-2xs` | 10px | Dense mono labels, badges |
| `text-caption` | 11px | Captions, host-editor chrome, meta |
| `text-xs` | 12px | Meta, mono labels, dense chrome |
| `text-ui` | 13px | Workbench UI text between xs and sm |
| `text-sm` | 14px | Default control / UI text |
| `text-base` | 16px | Comfortable body reading |
| `text-lg` | 18px | Emphasized body / small headings |
| `text-xl` | 22px | Subsection titles |
| `text-2xl` | 28px | Pane titles |

Rules:

- Use these utilities, never `text-[Npx]` or `text-[length:…]` literals. `npm run token-audit` flags them.
- `text-xs` and `text-sm` carry the inherited line-height from the Arc scale. When you need the size without a `leading-*` class, write `text-(length:--text-xs)` or `text-(length:--text-sm)` so the line-height is kept.
- `text-3xs`, `text-2xs`, `text-caption` and `text-ui` have no line-height companion. Pair them with an explicit `leading-*` class when the line box matters.

## Tokens

| Name | Resolves to | When to use |
| --- | --- | --- |
| `--font-display` | `"Geist", …` (via `--font-geist`) | Titles, display headings |
| `--font-body` | `"Inter", …` (via `--font-inter`) | UI body, labels, forms |
| `--font-family-mono` / `--font-mono` | `"IBM Plex Mono", ui-monospace, monospace` | Paths, ids, code snippets, figures |
| `--font-weight-regular` | `400` | Default body |
| `--font-weight-medium` | `500` | Labels, buttons, section titles |
| `--font-weight-semibold` | `600` | Strong emphasis (sparingly) |
| `--text-xs` | `0.75rem` | Meta, mono labels, dense chrome |
| `--text-sm` | `0.875rem` | Default control / UI text |
| `--text-base` | `1rem` | Comfortable body reading |
| `--text-lg` | `1.125rem` | Emphasized body / small headings |
| `--text-xl` | `1.375rem` | Subsection titles |
| `--text-2xl` | `1.75rem` | Pane titles |
| `--text-3xl` | `2.25rem` | Large headings |
| `--text-4xl` | `3.25rem` | Hero / rare display |
| `--text-5xl` | `4.5rem` | Maximum display |
| `--leading-display` | `1.1` | Display / heading line-height |
| `--leading-body` | `1.4` | Body and UI line-height |
| `--tracking-display` | `-0.03em` | Display headings |
| `--tracking-body` | `0` (ADE; Arc default was `-0.01em`) | Body and workbench UI |

## Light / dark

Typography tokens do not change with theme. Contrast is handled by `--foreground` / `--text-muted` and `--deck` / `--deck-foreground`.

## Do

- Use `--font-display` / `--font-body` / `--font-family-mono` with `--text-*` + `--leading-*` + `--tracking-*` together.
- Keep workbench UI mostly `text-xs` / `text-sm` / `text-ui` with `--font-weight-medium` for chrome.
- Use mono for machine-readable strings (paths, model ids, hashes).

## Don't

- Don't introduce new font families or hard-code `Inter` / `Geist` string literals in components.
- Don't pair `--tracking-display` with body copy.
- Don't use `text-4xl` / `text-5xl` inside dense ADE panes.
