# CLI harness facts (Codex / OpenCode / Pi / Claude Code)

Research date: 2026-09-29  
Local CLIs probed: `codex-cli 0.158.0`, `opencode 1.18.33`, `pi 0.87.0` (Node v24.12.0 under `~/.nvm/.../bin`).  
Rule: prefer official vendor docs + CLI `--help` / live output; mark gaps as **not documented**.

---

## 1. OpenAI Codex CLI

Sources:
- https://developers.openai.com/codex/cli
- https://developers.openai.com/codex/cli/reference
- https://developers.openai.com/codex/config-reference
- https://developers.openai.com/codex/config-sample
- https://developers.openai.com/codex/codex-manual
- https://github.com/openai/codex (package README / npm package `@openai/codex`)
- Local: `codex --help`, `codex update --help`, `codex exec --help`, `codex debug models --bundled`

### 1a. Official install command(s)

| Method | Command | Source |
| --- | --- | --- |
| macOS/Linux standalone | `curl -fsSL https://chatgpt.com/codex/install.sh \| sh` | [CLI overview](https://developers.openai.com/codex/cli), [GitHub README](https://github.com/openai/codex) |
| Windows PowerShell | `powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 \| iex"` | same |
| npm | `npm install -g @openai/codex` | same — **npm package name: `@openai/codex`** |
| Homebrew | `brew install --cask codex` | same |
| GitHub Releases binary | download platform archive from releases | GitHub README (details) |

Update via re-running the standalone installer is also shown on the CLI overview (“Update Codex” = same curl script). Homebrew upgrade shown as `brew upgrade --cask codex` on the overview.

### 1b. `codex update` behavior

- CLI help: `Update Codex to the latest version` — `codex update [OPTIONS]` with only global `-c` / `--enable` / `--disable` / `-h`. **No flags for install-method selection, non-interactive mode, or dry-run.**
- Official reference: “Check for and apply a Codex CLI update **when the installed release supports self-update**. Debug builds print a message telling you to install a release build instead.”  
  Source: https://developers.openai.com/codex/cli/reference (`codex update`)

**Detect install method?** **not documented** (docs only gate on “supports self-update,” not npm vs brew vs curl).  
**Non-interactive?** **not documented** (no flags; behavior for prompts/TTY not stated).  
**Exit codes?** **not documented**.

### 1c. Latest version without installing

- **No Codex subcommand** for “latest available version” appears in `codex --help` / reference.
- Working registry check (verified this machine): `npm view @openai/codex version` → `0.159.2` (local install was `0.158.0`).
- Official docs do **not** document `npm view` (or any other programmatic latest-check) as the supported method → treat as registry convention, not vendor-documented API.  
- Alternate artifact channel: GitHub Releases / installer CDN is described for installs; **a programmatic “latest version” API for Codex CLI is not documented** in the pages above.

### 1d. Reasoning effort for `codex exec`

- Override config with `-c key=value` on `codex` / `codex exec` (TOML-parsed value).  
  Example shape: `-c model_reasoning_effort="high"`  
  Sources: `codex exec --help`; [config reference](https://developers.openai.com/codex/config-reference).

- **Config key:** `model_reasoning_effort`  
- **Documented value guidance:**
  - Config reference: levels such as `low`, `medium`, `high`, `xhigh`, `max`, or `ultra`; “Available levels depend on the model and client.”
  - Sample config comment: `# Reasoning effort: minimal | low | medium | high | xhigh` with `model_reasoning_effort = "medium"`.
  - Related: `plan_mode_reasoning_effort` (`none | minimal | low | medium | high | xhigh` in sample comments).

**Per-model discoverability via `codex debug models`:** **yes (live).**  
`codex debug models` / `codex debug models --bundled` prints JSON `{ "models": [ ... ] }`. Each model entry can include:

- `supported_reasoning_levels`: array of `{ "effort": "<level>", "description": "..." }`
- `default_reasoning_level`
- `supports_reasoning_effort_updates`

Efforts observed in bundled catalog on this machine: `low`, `medium`, `high`, `xhigh`, `max`, `ultra` (union across models; per-model lists vary).

### 1e. Speed / fast / service tier for `codex exec`

**Yes — config key `service_tier`, plus feature `features.fast_mode`.**

| Item | Detail | Source |
| --- | --- | --- |
| Key | `service_tier` (string) | [config reference](https://developers.openai.com/codex/config-reference) |
| Documented values | Prefer `fast` or another tier advertised by the active model; **`fast` maps to request value `priority`**. Sample also mentions `flex`. | config-reference, config-sample, [codex manual “Fast mode”](https://developers.openai.com/codex/codex-manual) |
| Feature gate | `[features] fast_mode = true` (stable; on by default) enables Fast-tier selection | config-reference / manual |
| Interactive | `/fast on`, `/fast off`, `/fast status` | codex manual |
| Exec usage | Same `-c` overrides, e.g. `-c service_tier="fast"` (and optionally `-c features.fast_mode=true`) | inferred from global `-c` + config keys; **no dedicated `codex exec --fast` flag** in `codex exec --help` |

Catalog fields from `codex debug models` (empirical): `service_tiers` (e.g. `{ "id": "priority", "name": "Fast", ... }`), `additional_speed_tiers` (e.g. `["fast"]`), sometimes `default_service_tier`.

ChatGPT sign-in vs API key: manual states Fast mode credits apply with ChatGPT sign-in; with API key, Fast mode credits are not used.

---

## 2. OpenCode

Sources:
- https://opencode.ai/docs/
- https://opencode.ai/docs/cli/
- https://opencode.ai/docs/agents/
- https://opencode.ai/docs/models/
- Local: `opencode --help`, `opencode upgrade --help`, `opencode run --help`, `opencode models --help`, `opencode agent list`, `opencode models openai --verbose`

### 2a. Official install command(s)

| Method | Command | Source |
| --- | --- | --- |
| Install script (recommended) | `curl -fsSL https://opencode.ai/install \| bash` | [Intro](https://opencode.ai/docs/) |
| npm | `npm install -g opencode-ai` | same — **npm package name: `opencode-ai`** |
| Bun / pnpm / Yarn | `bun install -g opencode-ai`, `pnpm install -g opencode-ai`, `yarn global add opencode-ai` | same |
| Homebrew (tap) | `brew install anomalyco/tap/opencode` | same (docs warn core `brew install opencode` lags) |
| Arch | `pacman -S opencode` / AUR `opencode-bin` | same |
| Windows | Chocolatey / Scoop / npm / Mise / Docker also listed | same |

### 2b. `opencode upgrade` behavior

Official CLI docs (https://opencode.ai/docs/cli/):

```text
opencode upgrade [target]
opencode upgrade
opencode upgrade v0.1.48
```

Flag: `--method` / `-m` — “The installation method that was used; curl, npm, pnpm, bun, brew”  
Local help also lists `choco`, `scoop`.

**Auto-detect method?** Official **docs page does not state** that upgrade auto-detects; it documents optional `--method`.  
Local help makes `--method` optional (not required).  
*(Implementation in the OpenCode GitHub repo does call `Installation.method()` when `--method` is omitted, and prompts if `unknown` — that auto-detect/prompt behavior is **not spelled out** on opencode.ai/docs/cli.)*

**Non-interactive?** **not documented** on opencode.ai. Local upgrade UX uses interactive prompts (observed from vendor source / help flow); no `--yes` / non-interactive flag in `opencode upgrade --help`.

### 2c. Programmatic latest-version check

- CLI: `opencode --version` / `-v` reports **installed** version only.
- Verified: `npm view opencode-ai version` → `1.18.33` (matched local).
- Installer ecosystem also hits `https://opencode.ai/update/api/latest/cli/npm` (returned JSON with a `version` field when curled) — **this endpoint is not documented** on the public CLI docs page as a supported client API.
- **Vendor-documented dedicated “latest without install” command:** **not documented**.

### 2d. `--variant` on `opencode run` / discovering variants

- `opencode run --help`: `--variant` — “model variant (provider-specific reasoning effort, e.g., high, max, minimal)”.
- Docs: https://opencode.ai/docs/cli/ (`--variant` = “Model variant (provider-specific reasoning effort)”); https://opencode.ai/docs/models/ lists built-in variant names per provider family.

**`opencode models --verbose` (live, this machine):**  
Output shape is **one line `provider/model`**, then a **JSON object** per model. The object includes metadata (costs, limits, capabilities, etc.) and a **`variants` map**.

Example (non-empty):

```text
openai/gpt-5
{
  "id": "gpt-5",
  ...
  "variants": {
    "minimal": { "reasoningEffort": "minimal", "reasoningSummary": "auto", "include": ["reasoning.encrypted_content"] },
    "low": { ... },
    "medium": { ... },
    "high": { ... }
  }
}
```

Some models have `"variants": {}`. Docs describe `--verbose` as “includes metadata like costs”; they do **not** explicitly say “lists variants,” but the live verbose JSON **does** include per-model `variants` keys.

### 2e. `--agent plan` / `--agent build`

Confirmed built-in primary agents in official docs: **Build** and **Plan**  
Source: https://opencode.ai/docs/agents/

| Agent | Mode | Behavior (docs) |
| --- | --- | --- |
| `build` | primary (default) | Full tool access for development |
| `plan` | primary | Restricted planning/analysis. Default permissions: **file edits → `ask`**, **bash → `ask`**. Useful to analyze/suggest/plan **without making unintended changes**. Intro also describes Plan as disabling ability to make changes / suggest implementation. |

Usage: Tab to switch in TUI; CLI `--agent plan` / `--agent build` on `opencode` / `opencode run` (CLI docs).

Live: `opencode agent list` on this machine lists both `build (primary)` and `plan (primary)`. Local plan rules included `edit` `*` → `deny` with allow-exceptions for `.opencode/plans/*.md` (may reflect local config overlays; prefer docs for defaults).

---

## 3. Pi coding agent

Sources:
- https://github.com/badlogic/pi-mono / https://github.com/earendil-works/pi (`packages/coding-agent`)
- https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/README.md
- https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/docs/cli.md
- Local: `pi --help`, `pi update --help`, `pi --offline --list-models`

### 3a. Official install

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
```

**npm package name: `@earendil-works/pi-coding-agent`**  
Requires Node.js 22.19+.  

Alternate installer:

```bash
curl -fsSL https://pi.dev/install.sh | sh
```

Source: coding-agent README.

### 3b. `pi update self` behavior

From official CLI docs (`docs/cli.md`):

- `pi update` with no target updates Pi itself.
- Aliases: **`pi update --self`**, **`pi update self`**, **`pi update pi`** ≡ `pi update`.
- `--force`: reinstall Pi even when already on the selected/latest version (local help: “Reinstall pi even if the current version is latest”).
- Related: `--extensions`, `--models`, `--all`, per-package source updates.

Local `pi update --help` matches the above.  
**Install-method auto-detection details / exit codes:** **not documented** beyond the command table and `--force` note. (Older/package docs may mention installer-managed staged updates; not required for the self alias semantics above.)

### 3c. Latest-version check

- No dedicated “check latest only” command in docs/`--help`.
- Verified: `npm view @earendil-works/pi-coding-agent version` → `0.99.1` (local was `0.87.0`).
- **Official programmatic latest-check API/command:** **not documented** (use registry/`npm view` as practical approach).

### 3d. `--thinking` levels and per-model discovery

Documented levels (`pi --help` + `docs/cli.md`):

`off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`

Docs: “clamped to the model's capabilities.” Also `--model provider/id:thinking` suffix.

**`pi --offline --list-models` columns (live):**

```text
provider | model | context | max-out | thinking | images
```

`thinking` is **`yes` / `no`** (whether thinking is supported), **not** a list of allowed levels.  
**Discovering the exact supported thinking level set per model via list-models:** **not documented** / **not present** in the table (only boolean). Capability clamping is documented, but the enumeration API for levels is **not documented**.

### 3e. `--plan` flag

**Not built into core CLI** — registered by an **extension** (plan-mode).

Evidence:

- `pi --help`: “Extensions can register additional flags (e.g., `--plan` from plan-mode extension).”
- When the extension is loaded, help shows under **Extension CLI Flags:** `--plan` — “Start in plan mode” (this machine also showed `--ask`, `--mcp-config` from extensions).

**How to detect availability:**

1. Run `pi --help` and look for `--plan` under Extension CLI Flags (present only if an extension registered it).
2. `pi list` to see installed packages/extensions.
3. Without the extension, `--plan` is absent from core options.

---

## 4. Claude Code (install only)

Source: https://code.claude.com/docs/en/installation

**Recommended (native):**

- macOS / Linux / WSL: `curl -fsSL https://claude.ai/install.sh | bash`
- Windows PowerShell: `irm https://claude.ai/install.ps1 | iex`
- Windows CMD: `curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd`

Also documented: Homebrew `brew install --cask claude-code`, WinGet `winget install Anthropic.ClaudeCode`, and npm `npm install -g @anthropic-ai/claude-code` (advanced section).

---

## Quick cross-tool cheat sheet

| Need | Codex | OpenCode | Pi |
| --- | --- | --- | --- |
| npm package | `@openai/codex` | `opencode-ai` | `@earendil-works/pi-coding-agent` |
| Self-update cmd | `codex update` (if self-update supported) | `opencode upgrade` | `pi update` / `pi update --self` |
| Latest without install (practical) | `npm view @openai/codex version` | `npm view opencode-ai version` | `npm view @earendil-works/pi-coding-agent version` |
| Reasoning / effort | `-c model_reasoning_effort=...` | `opencode run --variant ...` | `pi --thinking ...` |
| Discover efforts/variants | `codex debug models` JSON `supported_reasoning_levels` | `opencode models --verbose` → `variants` | list-models: thinking yes/no only |
| Fast/speed tier | `service_tier` (`fast`→`priority`) + `features.fast_mode` | N/A (variants, not service tier) | N/A |
| Plan mode | (Codex has separate plan-mode reasoning key; not asked) | `--agent plan` (built-in) | `--plan` **extension** |

---

## Explicit “not documented” register

1. Codex `update`: install-method detection, non-interactive flags, exit codes.  
2. Codex programmatic latest-version command/API (beyond implied registry/releases).  
3. OpenCode `upgrade`: auto-detect and non-interactive behavior on **opencode.ai docs** (method flag only).  
4. OpenCode official “latest version” API for clients.  
5. Pi exact per-model thinking **level lists** via `--list-models`.  
6. Pi `update self` exit codes / install-method detection details.
