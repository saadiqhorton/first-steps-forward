# Motion

Durations and easing curves from Arc foundation, treated as Layer 2 by convention. Pair a duration with an ease; prefer spring only for transform “press” feedback.

Source: `src/components/arc/foundation.css`. Opacity helpers that often accompany motion live in `src/tokens.css`.

## Tokens

| Name | Resolves to | When to use |
| --- | --- | --- |
| `--duration-instant` | `120ms` | Opacity flickers, reduced-motion fallbacks |
| `--duration-fast` | `160ms` | Color, border, opacity on hover/focus |
| `--duration-standard` | `240ms` | Layout / size transitions |
| `--duration-considered` | `480ms` | Enter animations (e.g. rise) |
| `--duration-spring` | `580ms` | Transform presses with `--ease-spring` |
| `--ease-enter` | `cubic-bezier(.16,1,.3,1)` | Elements arriving on screen |
| `--ease-standard` | `cubic-bezier(.22,1,.36,1)` | Default UI transitions |
| `--ease-exit` | `cubic-bezier(.7,0,.84,0)` | Elements leaving |
| `--ease-in-out` | `cubic-bezier(.65,0,.35,1)` | Symmetric in/out motion |
| `--ease-spring` | `linear(…)` bounce settle | Press / scale feedback with `--duration-spring` |
| `--opacity-disabled` | `0.52` | Disabled control opacity |
| `--opacity-hover` | `0.91` | Hover dim on filled controls |
| `--opacity-pressed` | `0.84` | Pressed opacity |
| `--opacity-muted` | `0.3` | Strongly de-emphasized chrome |

## Light / dark

Motion and opacity tokens are theme-invariant.

## Do

- Default interactive chrome to `--duration-fast` + `--ease-standard`.
- Use `--duration-spring` + `--ease-spring` only for transform press (not for color).
- Respect `prefers-reduced-motion`: collapse to `--duration-instant` / no transform.

## Don't

- Don't invent new ms values or cubic-beziers for product UI.
- Don't put spring easing on opacity-only transitions.
- Don't animate layout with spring durations — prefer `--duration-standard`.
