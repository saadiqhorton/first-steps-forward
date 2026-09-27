# ADE Product Design Spec

**Status:** Rewritten product direction  
**Audience:** Product, design, and engineering  
**Product:** ADE (working name)  
**Positioning:** A free, open-source workspace for building and shipping software with AI coding agents

## 1. Product vision

ADE makes working with capable coding agents feel like working on a project, instead of juggling a collection of model-specific apps, terminals, browser tabs, and handoff notes.

A person should be able to open a project, describe a change in plain language, see the agent make it, try the result in a built-in preview, and move on. ADE keeps project switching, agent sessions, previews, local processes, and useful run status in one calm workspace. It should help people spend their attention on deciding what to build and getting it in front of users.

ADE is a free, open-source alternative in the spirit of Enjoy.dev. The product itself should not require a paid subscription or time-limited trial. The first release is self-hosted only: ADE runs on the user’s own computer or infrastructure, and the project does not depend on an ADE-hosted service or relay. Model access is a separate concern: users can connect providers or local models they choose, and those providers may charge for inference.

## 2. Problem

Solo builders and small teams often move between coding agents, IDEs, terminals, browsers, Git hosts, and deployment tools. This fragmentation creates overhead:

- People lose track of which project or agent session is active.
- They repeat context or create handoff documents when switching tools or providers.
- Local servers and browser previews are hard to find after they start.
- Agent output exposes a lot of technical detail without making it clear what needs attention.
- Builders spend time organizing work into systems instead of testing ideas with real users.

ADE brings the working surface together and keeps the next useful action visible. It does not try to replace the codebase as the durable source of truth.

## 3. Target users

### Primary

- Solo builders, founders, and technically curious creators validating an idea.
- Non-specialist developers who can describe the product they want but find terminal-heavy workflows distracting.
- Experienced developers who want one place to manage several projects, agent sessions, and previews across the coding agents they already use.

### Secondary

- Small product teams using AI coding agents for prototypes and routine changes.
- Developers who want a local-first desktop workspace with replaceable agent and model integrations.

ADE is not initially designed for regulated or safety-critical software delivery. Those use cases need organization-specific controls and review processes. ADE’s runtime should still provide meaningful safeguards; the product should not imply that quick iteration is appropriate for every codebase.

## 4. Product principles

1. **Start with the task.** A user should be able to ask for a change in a few sentences and give acceptance criteria when needed.
2. **Keep sessions disposable and projects durable.** Conversations are task sessions that can be completed and hidden. The repository remains the main durable context.
3. **Make the work visible.** Put the preview, running process, and the agent’s current state close to the task.
4. **Hide machinery until it matters.** Git, logs, diffs, permissions, and runtime details are available when useful, but they do not dominate the default view.
5. **Use simple defaults; add structure in response to evidence.** Don’t require task boards, long project bibles, agent hierarchies, or elaborate workflows to start.
6. **Let users choose their agents.** ADE coordinates existing coding agents and model providers; it does not lock users into one model or require a proprietary inference service.
7. **Match safeguards to risk.** Routine reversible work should feel direct. Potentially destructive, external, or sensitive actions need clear controls and review.
8. **Help users ship and learn.** The goal is a working change that can be tried by a person, not an ever-growing backlog or activity feed.

## 5. Core experience

### Project home

The project home gives a readable snapshot of what is useful now:

- Current preview and whether the development server is running.
- Active work sessions and a clear “needs you” state when an agent is blocked or asking a question.
- Recent completed work, with concise summaries and links to the actual code changes.
- Workflows such as tests, CI, or deployment when configured.

Avoid a dashboard full of charts, agent traces, and project-management ceremony. A new user should understand the project without asking an agent to explain ADE’s own status system.

### Start a task

The primary action is **New task**. The user selects a project, writes a short request, optionally adds acceptance criteria or a screenshot, and chooses an agent/provider if they want to override the project default. ADE starts a fresh session with the right repository and a small, relevant context package.

A task can run while the user views another project or session. Users may have several concurrent tasks, but ADE should not encourage overlapping edits to the same files. If scopes overlap, ADE should surface the conflict and offer isolation or sequencing. The same project should be usable through different supported coding agents without requiring handoff documents or ADE-specific project files.

### Work session

A session is a focused conversation associated with a project and a concrete change. The main view emphasizes:

- The user’s request and any acceptance criteria.
- A concise state such as working, needs input, verifying, or complete.
- The agent’s response and a readable summary of changes.
- A preview when the project can be run.
- Optional access to diff, files changed, logs, tool activity, and verification details.

The user can steer or answer questions without writing a handoff document. They can switch agent/provider where supported; ADE should pass the relevant repository and task state directly and clearly disclose when a provider switch cannot preserve the prior conversation.

When the task is finished, the user can mark it complete. It leaves the active view but remains searchable and reopenable. Do not delete work or session history merely because a task is completed.

### Design workshop

For visual work, users can ask an agent to explore a few options before changing the product. ADE should support disposable preview artifacts that can be compared side by side. The user selects a direction, gives concise feedback, then asks the agent to implement it. Workshop files are clearly marked as explorations and are not silently shipped as production code.

### Preview and local processes

ADE provides a built-in browser preview beside the task. It can start, open, stop, and show output for local development processes, so users do not have to remember which terminal owns a server. Multiple processes are named by project and purpose. The interface should explain which URL is local and which actions affect external environments.

### Workflows

Users can run and monitor project workflows such as tests, CI, and deployment. They can request a bounded follow-up action, such as investigating a failed test run. Before an agent retries or changes code based on a workflow result, it must show the scope and obtain confirmation when the action could publish, modify shared state, or incur material cost.

### Mobile access

The longer-term experience should let a user check project status, answer a question, start a task, or open a preview from a phone or another browser. This is a later milestone, not a requirement for the first usable release.

## 6. Functional requirements

### MVP: self-hosted project workspace

1. **Self-hosted deployment**
   - Provide a straightforward setup for running ADE on the user’s own computer or infrastructure.
   - Keep project files, session data, process control, and previews under the user’s control.
   - Do not require an ADE cloud account, hosted backend, hosted relay, or ADE-operated storage service.
   - Clearly document any optional third-party provider connection and what data it receives.

2. **Projects**
   - Add and switch between local repositories.
   - Display project name, path, current branch, and active local processes.
   - Do not require a project board or a prescribed documentation structure.

3. **Agent sessions and adapters**
   - Start a fresh task session for a project.
   - Include first-release adapters for OpenAI Codex, OpenCode, and Pi Agent. Keep the adapter design open to additional widely used coding agents.
   - Defer Claude Code support to a later release.
   - Stream status and responses; allow user steering and follow-up questions.
   - Complete, hide, search, and reopen sessions.
   - Keep session records separate from repository files unless the user explicitly asks to save an artifact into the project.
   - Show which agent created each session and what information can carry over when changing agents.

4. **Simple sign-in and account selection**
   - Make the selected agent, provider, and account visible.
   - Guide the user through sign-in inside ADE, using the provider’s OAuth or device authorization flow wherever supported. The normal setup path should not require API keys, editing JSON, environment variables, or terminal commands.
   - Detect supported agent installations and explain any required setup in plain language. Prefer launching the agent’s own sign-in flow over reimplementing or storing provider credentials.
   - If a provider does not offer a supported OAuth/device flow, explain that limitation before offering an optional credential entry path; never make manual configuration the default.
   - Allow switching among configured accounts and agents without a handoff document.
   - Store any required credentials in the operating system’s secure credential store, never in project files.

5. **Change visibility**
   - Show concise files-changed and verification summaries.
   - Offer a readable diff and direct access to logs and raw output.
   - Detect uncommitted user work before an agent is allowed to overwrite or discard it.
   - Never silently revert or replace user changes.

6. **Preview and processes**
   - Start, reopen, stop, and inspect local processes associated with a project.
   - Show process output and preview URL.
   - Prevent accidental confusion between local previews and external production environments.

7. **Simple verification**
   - Let an agent run the project’s existing tests or user-selected checks.
   - Report each check as passed, failed, skipped, or not run.
   - Never describe a change as verified when relevant checks did not run.

### After MVP

- Claude Code adapter and additional agent integrations, based on user demand and supported authentication paths.
- Workflow integrations for CI and deployment providers.
- Browser-based remote access and mobile controls, connecting only to a user-controlled ADE host unless the project later chooses to add a hosted service.
- Optional project notes and pinned documents, without requiring them for agent context.
- Safe concurrency support for independent tasks, with workspace isolation when tasks overlap.
- Additional agent and model adapters, including local inference options.

## 7. Runtime guarantees and risk controls

The everyday interface stays light, while the execution layer enforces protections that users should not have to remember.

### Context and scope

- Each run receives a concise context manifest recording the project, requested task, relevant files, tools available, and constraints applied.
- Resolve paths against the selected project and reject ambiguous or out-of-scope writes.
- Check for uncommitted user work and stale context before making changes.
- Expose tools in phases appropriate to the current run state; do not make destructive or external-action tools available by default.
- Treat repository content, web pages, and tool output as untrusted input. Instructions found inside them cannot override the user’s request or runtime policy.
- Project memory is optional, scoped, version-aware, and evidence-linked. Do not create agent-generated notes by default or treat them as a second source of truth.

### Changes and verification

- Preserve user work. Detect overlapping edits and ask the agent to avoid unrelated changes.
- Use the simplest workable Git setup by default. Do not force branches or worktrees for every task. Offer isolation when the user requests it, when tasks overlap, or when the risk of concurrent edits warrants it.
- Record a decision snapshot of the task, changes, checks, and actions taken so a result can be understood later.
- Separate implementation from verification in status and reporting. Show actual check evidence and coverage; label missing checks plainly.
- Describe rollback options for changes that affect shared or external state. Clearly warn before irreversible actions.

### Permission and failure handling

- Classify actions by risk. Read-only inspection and routine local edits can proceed within the configured project scope. Deletion, credential access, external writes, deployment, publishing, or significant costs require explicit scoped confirmation.
- Approval should be specific to the action, target, and scope; do not use broad, indefinite approvals as the default.
- Provide a concise, human-readable outcome first, with technical traces available on demand.
- Use severity levels S0–S5 internally to prioritize failure response. Tell the user what failed, what may have changed, and the recovery options.
- If a provider, process, or tool fails, distinguish timeout, unavailable provider, permission denial, malformed response, and execution failure. Do not report successful completion from partial output.
- Telemetry is off by default. Any optional diagnostics must be disclosed and controllable.

These are runtime guarantees, not a reason to make every task feel like a compliance workflow. The amount of review should grow with the impact and reversibility of the requested action.

## 8. What ADE will not require

- A Kanban board or backlog to use the product.
- A long agent instruction file, project bible, or generated handoff note for every change.
- An agent factory, mandatory sub-agent hierarchy, or custom message bus.
- A permanent mega-conversation for each project.
- A dedicated Git branch or worktree for every task.
- A proprietary model subscription bundled with the workspace.
- A technical trace view as the default home screen.
- A claim that code quality, testing, or security can be ignored. Those needs depend on the project’s stage and risk.

## 9. Nonfunctional requirements

- **Self-hosted first:** The initial product runs on the user’s own machine or infrastructure. There is no ADE-hosted control plane, account requirement, relay, or storage dependency. Repository files remain under the user’s control; any optional remote execution or sync is explicit and clearly described.
- **Open and replaceable:** Core project/session data uses documented, exportable formats. Agent and provider integrations are adapter-based.
- **Reliable:** A crash or provider interruption must not lose the user’s request, completed edits, or recorded run state.
- **Responsive:** Project switching, session navigation, and opening a local preview should feel immediate; long-running work must remain observable without blocking the workspace.
- **Accessible:** Primary controls are keyboard accessible, status is not communicated by color alone, and nontechnical language is used by default.
- **Private:** No telemetry by default; credentials are stored securely; remote exposure of a local preview requires deliberate configuration.
- **Network exposure is opt-in and token-gated:** ADE binds loopback by default. Non-loopback exposure happens only through an explicit `ADE_HOST` + `ADE_TOKEN` configuration (`scripts/start-local.mjs` refuses a non-loopback bind without a token), and every API request from a non-loopback client must prove that token (bearer header or the browser's `HttpOnly` session cookie). Local agent CLIs and loopback clients remain exempt; a `tailscale serve`-style HTTPS proxy in front of the loopback bind is the recommended path for remote access.

## 10. Success measures

Measure whether ADE reduces friction and helps users reach feedback, rather than whether it maximizes time in the app.

- Time from opening a project to starting the first useful task.
- Share of sessions that reach a clear outcome: implemented, deliberately stopped, or blocked with an explanation.
- Time from task completion to viewing a working preview.
- Number of manual context handoffs needed when switching agents or providers.
- User-reported clarity about what is running and what needs their input.
- Weekly active projects that produce a preview or a shipped change.
- Rate of accidental overwrites, unclear verification claims, and unintended external actions.

## 11. Delivery plan

### Milestone 1: usable core

Self-hosted setup, project switching, new/complete task sessions, Codex, OpenCode, and Pi Agent adapters, guided OAuth/device sign-in wherever supported, process controls, preview pane, change summary, diff access, and basic run safeguards.

### Milestone 2: dependable iteration

Session search and reopen, richer verification reporting, conflict detection, provider/account switching, credential handling, and recovery after interrupted runs.

### Milestone 3: design and delivery loop

Disposable visual workshops, workflow monitoring, bounded CI repair, and clearer deployment controls.

### Milestone 4: remote supervision

Secure remote access, phone-friendly status and steering, and optional self-hosted collaboration.

## 12. Open decisions

These should be resolved during implementation discovery without blocking the product direction:

- Which additional coding-agent adapters should follow Codex, OpenCode, and Pi Agent?
- Which platforms are first-class for the desktop workspace?
- What session metadata is stored locally, and what export format is the minimum useful baseline?
- If remote access is added, what secure connection method should users configure to reach their self-hosted ADE instance?
- Which project actions need confirmation in the first release, beyond destructive changes and external side effects?

## 13. Product acceptance test

A first-time user can add a local project, sign in to a supported coding agent through a guided flow, ask it for a small feature in plain language, see the agent’s state, open the running preview, inspect what changed, and mark the task complete. The user can then start a separate task without preparing a handoff document or reorganizing the project into ADE-specific process files. If the agent needs input, the workspace makes that obvious. If a requested action could overwrite user work or change external state, ADE stops and explains the decision in plain language.
