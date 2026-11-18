# Typography

Type scale, families, leading, tracking, and weights. Font families exist as Arc/ADE names (`--font-display` / `--font-body` / `--font-mono`) and Layer 2 aliases (`--font-family-*`). Prefer the aliases in new component CSS; both are Layer 2 by convention.

Sources: type scale / leading / tracking in `src/components/arc/foundation.css`; ADE overrides `--tracking-body: 0` and font face bindings in `src/styles.css`; weights + `--font-family-*` in `src/tokens.css`.

## Tokens

| Name | Resolves to | When to use |
| --- | --- | --- |
| `--font-family-display` / `--font-display` | `"Geist", …` (via `--font-geist`) | Titles, display headings |
| `--font-family-body` / `--font-body` | `"Inter", …` (via `--font-inter`) | UI body, labels, forms |
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

Typography tokens do not change with theme. Contrast is handled by `--color-text*` / `--color-deck*`.

## Do

- Use `--font-family-*` (or `--font-*`) with `--text-*` + `--leading-*` + `--tracking-*` together.
- Keep workbench UI mostly `--text-xs` / `--text-sm` with `--font-weight-medium` for chrome.
- Use mono for machine-readable strings (paths, model ids, hashes).

## Don't

- Don't introduce new font families or hard-code `Inter` / `Geist` string literals in components.
- Don't pair `--tracking-display` with body copy.
- Don't jump to `--text-4xl` / `--text-5xl` inside dense ADE panes.
