# Composer File Attachments Implementation Plan

> **For agentic workers:** Implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users attach images, screenshots, and files in the ADE composer so local coding agents receive them on the next turn.

**Architecture:** Store bytes in `~/.ade/attachments/<uuid>/` (not the project). Upload on send via `POST /api/attachments`. Pass `attachmentIds` into session create and follow-up. Keep user-visible message text clean; inject absolute paths into the CLI prompt and native adapter flags (`codex --image`, `opencode --file`, Pi `@path`). Composer grows a paperclip, chip row, drag overlay, and paste-screenshot handler.

**Tech Stack:** React, existing ADE composer tokens (`btn-quiet`, `card-panel`, lucide), Node local API, node:test.

## Global Constraints

- Do not write attachments into the project working tree
- Do not install Arc `file-upload` or `file-dropzone`; match Composer/ADE styling
- No em dashes in copy; sentence case; icon-only controls have specific names
- Do not commit unless this dispatch says to (it does not)
- Do not force-push, rebase, or rewrite git history
- Keep `queuedMessages` as `string[]`: bake the path appendix into the queued CLI text, not into the displayed user message
- `handleLocalApi` currently utf8-decodes bodies and caps at 1 MiB. Attachment JSON is utf8-safe; raise the cap only for `POST /api/attachments`
- `canSend` still requires trimmed text. Attachments never replace a description
- Image kind is `image/png`, `image/jpeg`, `image/jpg`, `image/gif`, `image/webp`, `image/bmp` (clipboard screenshots). Everything else is `file`

---

## File map

- Create: `src/local/attachments.mjs` — save/read/limits/prompt appendix
- Create: `src/local/attachments.test.mjs`
- Create: `src/local/ade-local.attachments.test.mjs` — HTTP upload + session ids
- Create: `src/components/ade/ComposerAttachments.tsx` — chips, paperclip, drop overlay
- Modify: `src/local/ade-local.mjs` — routes, runAgent prompt, payload size
- Modify: `src/local/adapters/codex.mjs`, `opencode.mjs`, `pi.mjs` — native flags
- Modify: `src/local/adapters/adapters.test.mjs`
- Modify: `src/lib/ade/types.ts` — `MessageAttachment`, `Message.attachments`
- Modify: `src/lib/ade/store.tsx` — upload helper, `startTask`/`steer` ids
- Modify: `src/components/ade/Composer.tsx`
- Modify: `src/components/ade/NewTaskForm.tsx`, `SessionView.tsx`, `SessionMessage.tsx`
- Modify: `package.json` test script to include the two new test files

---

### Task 1: Attachment storage module + tests

**Files:**
- Create: `src/local/attachments.mjs`
- Create: `src/local/attachments.test.mjs`
- Modify: `package.json` (add `src/local/attachments.test.mjs` to the `test` script)

**Interfaces:**
- Consumes: Node `fs`, `path`, `crypto.randomUUID`
- Produces: functions below. Later tasks import these exact names.

```js
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_TURN_BYTES = 20 * 1024 * 1024;
export const MAX_FILES = 8;
export const IMAGE_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  "image/bmp",
]);

export function attachmentKind(mime) {
  return IMAGE_MIMES.has(String(mime || "").toLowerCase()) ? "image" : "file";
}

export function sanitizeFilename(name) {
  // basename only, strip NULs and path separators, max 200 chars, fallback "file"
}

export function decodeBase64(contentBase64) {
  // throw { status: 400, message } on invalid
}

export async function saveAttachment(dataDir, { name, mime, bytes }) {
  // reject empty, over MAX_FILE_BYTES
  // id = randomUUID()
  // dir = path.join(dataDir, "attachments", id) mode 0o700
  // write bytes to path.join(dir, "file") mode 0o600
  // write meta.json { id, name: sanitizeFilename(name), mime, size: bytes.length, kind }
  // return meta
}

export async function readAttachment(dataDir, id) {
  // id must match /^[0-9a-f-]{36}$/i else throw 400
  // read meta + file bytes; 404 if missing
  // return { ...meta, bytes, absPath: path.join(dataDir, "attachments", id, "file") }
}

export async function resolveAttachments(dataDir, ids) {
  // unique ids, max MAX_FILES, total size MAX_TURN_BYTES
  // return array of readAttachment results in given order
}

export function formatAttachmentPrompt(attachments) {
  // attachments: [{ name, mime, size, absPath }]
  // Return "" if empty.
  // Otherwise a trailing block (no em dash):
  //
  // The user attached these files for this turn. They are stored by ADE outside the project. Read them as needed. Do not copy them into the repository unless the user asked.
  //
  // - name (mime, N KB): absPath
}

export function formatSize(bytes) {
  // 0 B, N B, N KB, N MB — one decimal for MB only when >= 1_000_000
}
```

- [ ] **Step 1: Write failing tests** in `src/local/attachments.test.mjs` using `node:test` and a temp `HOME`-style data dir (`mkdtempSync`). Cover: save+read roundtrip, empty rejected, oversize rejected, bad id rejected, path-like filename sanitized, resolveAttachments enforces count and total size, `formatAttachmentPrompt` includes absPath and stays empty for `[]`.

- [ ] **Step 2: Implement `attachments.mjs` until tests pass.**

- [ ] **Step 3: Add the new test file to `package.json` `scripts.test`.**

---

### Task 2: Local API routes and session wiring

**Files:**
- Modify: `src/local/ade-local.mjs`
- Create: `src/local/ade-local.attachments.test.mjs`
- Modify: `package.json` test script (add the new file)

`DATA_DIR` is already `path.join(os.homedir(), ".ade")`. Pass `DATA_DIR` into the attachment helpers.

**POST /api/attachments**

JSON body: `{ name: string, mime: string, contentBase64: string }`.

In `handle()` add this route before generic session handling. Do not use `body()`'s 1 MiB cap.

In `handleLocalApi`, if `request.method === "POST"` and pathname is `/api/attachments`, call `boundedText(request, 14 * 1024 * 1024)` instead of the default 1 MiB. Leave every other route at 1 MiB.

Inside the route, `JSON.parse` the payload, `decodeBase64`, `saveAttachment(DATA_DIR, ...)`, return 201 `{ id, name, mime, size, kind }`. Map helper throws `{ status, message }` to `json(res, status, { error: message })`.

**GET /api/attachments/:id**

`readAttachment`, then:

```js
res.statusCode = 200;
res.setHeader("content-type", meta.mime || "application/octet-stream");
res.setHeader("cache-control", "private, max-age=3600");
res.setHeader("content-disposition", `inline; filename="${encodeURIComponent(meta.name)}"`);
res.end(meta.bytes);
```

In `handleLocalApi`, `response.body` may be a Buffer. `new Response(response.body, ...)` must keep binary GET intact. If you currently coerce body to string, stop doing that for Buffers.

**Session create and follow-up**

`POST /api/sessions` and `POST /api/sessions/:id/messages` read `attachmentIds` (optional array of strings).

```js
const attachmentIds = Array.isArray(data.attachmentIds) ? data.attachmentIds : [];
const files = attachmentIds.length ? await resolveAttachments(DATA_DIR, attachmentIds) : [];
```

On the stored user message:

```js
{
  id: id(),
  role: "user",
  text: request, // existing text rules unchanged; criteria still appended for the first user message as today
  at: now(),
  ...(files.length
    ? {
        attachments: files.map(({ id, name, mime, size, kind }) => ({
          id, name, mime, size, kind,
        })),
      }
    : {}),
}
```

Do **not** put absolute paths in `message.text`.

When calling `runAgent` or pushing `queuedMessages`, use:

```js
const prompt = `${userVisibleText}${formatAttachmentPrompt(files)}`;
```

For queued follow-ups, push that `prompt` string (so drain still `queue.join("\n\n")`). The displayed message still uses `userVisibleText` plus `attachments` metadata.

Pass `files` into `runAgent` and then `agentCommand`.

Change `runAgent(session, prompt, continuing)` to `runAgent(session, prompt, continuing, attachments = [])`.

Change `agentCommand(session, project, prompt, continuing)` to take attachments and pass them to `adapter.command({ ..., attachments })`.

Every existing `runAgent(...)` call that is a drain of `queuedMessages` already has paths baked into the string; pass `[]` for attachments there (flags were needed at queue time — see note).

**Important queue gap:** `queuedMessages` is only text. Native `--image`/`--file` flags will be missing on a drained queued turn unless we also stash paths. Fix: when queueing, still bake the path appendix into the text (agent can Read), and also store absPaths by parsing nothing. Simpler correct fix: change queue entries to strings that already include the appendix (agent Read works for all three CLIs). Native flags on the queued drain are optional. **For v1, native flags apply only to the turn spawned immediately, not to drained queued follow-ups.** Document this in a code comment on the queue push. The path appendix is enough for the agent to Read the files.

- [ ] **Step 1: Write HTTP tests** in `src/local/ade-local.attachments.test.mjs` following `ade-local.enjoy.test.mjs` isolation (`mkdtempSync` HOME, seed agents that are signed in, import `handleLocalApi` after setting `process.env.HOME`). Cover:
  - POST attachment 201 returns id/name/size/kind
  - GET returns the same bytes and content-type
  - POST empty/oversize 400
  - POST `/api/sessions` with `attachmentIds` puts metadata on the first user message and does not put the absPath in `messages[0].text`
  - POST `/api/sessions/:id/messages` with ids attaches metadata
  - Stop any spawned session so later tests are not blocked (`POST .../stop`)

  Reuse the enjoy test's `handleLocalApi` wrapping style. If seeding a workspace file, copy the enjoy test's pattern (write `workspace.json` and `agents-status.json` before import). If `ade-local.mjs` is already imported by other tests in the same process, prefer calling through the already-exported `handleLocalApi` and a HOME that matches how enjoy tests work — this new file should be a **separate Node test file** so `HOME` is set before import, like enjoy.

- [ ] **Step 2: Implement routes and session wiring.** Raise `handleLocalApi` body cap only for POST `/api/attachments`.

- [ ] **Step 3: Run** `node --test src/local/attachments.test.mjs src/local/ade-local.attachments.test.mjs` and fix until pass.

---

### Task 3: Adapter CLI flags

**Files:**
- Modify: `src/local/adapters/codex.mjs`
- Modify: `src/local/adapters/opencode.mjs`
- Modify: `src/local/adapters/pi.mjs`
- Modify: `src/local/adapters/adapters.test.mjs`

`attachments` defaults to `[]`. Each item has `{ path, mime, kind, name }` where `path` is `absPath`.

**Codex** — insert image flags immediately before the prompt (the last argv entry is the prompt today):

```js
const imageArgs = (attachments ?? [])
  .filter((a) => a.kind === "image")
  .flatMap((a) => ["--image", a.path]);
```

Apply on both `codex exec` and `codex exec resume` argv arrays.

**OpenCode** — for every attachment:

```js
const fileArgs = (attachments ?? []).flatMap((a) => ["--file", a.path]);
```

Insert before the prompt argument.

**Pi** — for every attachment, insert `@${path}` arguments immediately before the prompt (the last argv entry). Example: `["-p", "--mode", "json", ..., `@${absPath}`, prompt]`.

- [ ] **Step 1: Extend adapter tests** with a fixture attachment `{ path: "/tmp/shot.png", mime: "image/png", kind: "image", name: "shot.png" }` plus a non-image `{ path: "/tmp/notes.txt", mime: "text/plain", kind: "file", name: "notes.txt" }`.
  - Codex includes `--image` `/tmp/shot.png` and does **not** pass `--image` for notes.txt
  - OpenCode includes `--file` for both paths
  - Pi includes `@/tmp/shot.png` and `@/tmp/notes.txt` before the prompt
  - Existing tests that omit `attachments` still pass

- [ ] **Step 2: Implement adapter argv changes.**

- [ ] **Step 3: Thread `attachments` from `agentCommand` in `ade-local.mjs`:** map helper results to `{ path: absPath, mime, kind, name }`.

- [ ] **Step 4: Run** `node --test src/local/adapters/adapters.test.mjs src/local/ade-local.attachments.test.mjs`

---

### Task 4: Composer UI

**Files:**
- Create: `src/components/ade/ComposerAttachments.tsx`
- Modify: `src/components/ade/Composer.tsx`

Match existing Composer classes (`btn-quiet`, `text-dim`, `border-line`, lucide icons). Do not add focus rings beyond the composer card's existing `has-[textarea:focus-visible]:ring-amber/35` pattern. Paperclip is `btn-quiet` square `size-9` like Send, or a quieter `size-8` next to the branch label; keep Send as the only amber control.

**Draft type** (local to the component file):

```ts
export type AttachmentDraft = {
  key: string;
  file: File;
  previewUrl?: string;
};
```

`ComposerAttachments` props:

```ts
{
  drafts: AttachmentDraft[];
  disabled?: boolean;
  onAddFiles: (files: File[]) => void;
  onRemove: (key: string) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  dragging: boolean;
}
```

Render:

1. Hidden `<input type="file" multiple className="sr-only" />` — no accept restriction. Label via the paperclip `aria-label="Attach files"`.
2. If `drafts.length`, a wrap row of chips (`px-4 pb-2` owned by Composer around this). Image drafts use `<img src={previewUrl} alt="" className="size-10 rounded object-cover" />`. File drafts use lucide `File` icon. Show `draft.file.name` truncated, `formatSize` from a tiny local copy of the size formatter (do not import the server module from the client). Remove button per chip: `aria-label={`Remove ${draft.file.name}`}`.
3. Paperclip button (`Paperclip` lucide) that clicks the file input. Disabled when `disabled` or `drafts.length >= 8`.
4. When `dragging`, an overlay on the composer: `Drop files to attach`.

**Composer.tsx changes:**

- Hold `drafts` state.
- `key` = `${file.name}:${file.size}:${file.lastModified}:${index}` plus `crypto.randomUUID()` when available, else increment.
- Create `URL.createObjectURL(file)` for `file.type.startsWith("image/")`; `useEffect` cleanup revokes URLs.
- `addFiles(files: File[])`: skip empty files; cap at 8 total; skip a file over 10 MiB with `window.alert("filename is larger than 10 MB.")`; skip if adding it would exceed 20 MiB total.
- `onSend` becomes `(text: string, files: File[]) => Promise<boolean>`. After successful send (`true`), clear drafts.
- `canSend` remains `!!text.trim() && !disabled` (files optional).
- Textarea `onPaste`: if `event.clipboardData?.files?.length` or clipboard items of type `image/*`, `preventDefault` and `addFiles`.
- Root composer `onDragOver` preventDefault, `onDrop` add files, track `dragging` with dragenter/leave counter so child enters do not flicker.
- Place paperclip in the footer row, before the Send button (`ml-auto` stays on Send). Chips render above the footer, below the textarea.

Copy: "Attach files", "Drop files to attach", "Remove {name}". No em dashes.

- [ ] **Step 1: Implement `ComposerAttachments` and wire Composer.** Typecheck the changed files mentally against existing Composer props. Keep `extra`, picker portal, and send keyboard behavior intact.

- [ ] **Step 2: `npx tsc --noEmit` must pass.**

---

### Task 5: Upload on send, thread chips, store API

**Files:**
- Modify: `src/lib/ade/types.ts`
- Modify: `src/lib/ade/store.tsx`
- Modify: `src/components/ade/NewTaskForm.tsx`
- Modify: `src/components/ade/SessionView.tsx`
- Modify: `src/components/ade/SessionMessage.tsx`

**types.ts**

```ts
export interface MessageAttachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  kind: "image" | "file";
}
export interface Message {
  id: string;
  role: "user" | "agent" | "system";
  text: string;
  at: number;
  attachments?: MessageAttachment[];
}
```

**store.tsx**

Add:

```ts
export async function uploadAttachment(file: File): Promise<MessageAttachment> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
  const contentBase64 = btoa(binary);
  return request<MessageAttachment>("/api/attachments", "POST", {
    name: file.name,
    mime: file.type || "application/octet-stream",
    contentBase64,
  });
}
```

Use a chunked conversion if files can be 10 MiB (`FileReader` or `btoa` on chunks) so you do not blow the stack. A simple loop on 10 MiB is acceptable in Chromium.

Extend `startTask` input with `attachmentIds?: string[]` and pass through the POST body.

Extend `steer(sessionId, text, attachmentIds?: string[])` to POST `{ text, attachmentIds }`.

**NewTaskForm `onSend`:**

```ts
const onSend = async (text: string, files: File[]) => {
  // existing guards unchanged
  let attachmentIds: string[] = [];
  if (files.length) {
    try {
      attachmentIds = (await Promise.all(files.map(uploadAttachment))).map((a) => a.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }
  const s = await startTask({ ..., ...(attachmentIds.length ? { attachmentIds } : {}) });
  ...
};
```

**SessionView `send`:** same upload then `steer(session.id, outgoing, attachmentIds)`.

**SessionMessage:** if `message.attachments?.length`, render a chip row under the text. Images: `<img src={/api/attachments/${id}} alt={name} className="size-12 rounded object-cover" />`. Files: icon + name. Use the same visual language as composer chips. For collapsed long-user prompts, still show the chip row on the closed chip so attachments are visible without expanding.

- [ ] **Step 1: Types + store + forms + SessionMessage.**
- [ ] **Step 2: `npx tsc --noEmit` and `npm test`.** Fix failures. Existing tests that POST `/api/sessions` without `attachmentIds` must keep working.

---

### Task 6: Polish and verify

- [ ] **Step 1:** Grep the diff for em dashes, `uppercase`, and leftover TODOs in new copy.
- [ ] **Step 2:** `npm test` and `npx tsc --noEmit` and `npm run lint` on your changes.
- [ ] **Step 3:** If a dev server is already running, do not start a second one. Otherwise you do not need to start one; the parent will browser-check.

---

## UI notes for ComposerAttachments

Chip:

```tsx
<div className="flex max-w-[220px] items-center gap-2 rounded-lg border border-line bg-panel px-2 py-1.5">
  {/* thumb or File icon */}
  <span className="min-w-0 truncate text-[12px]" title={name}>{name}</span>
  <button type="button" className="btn-quiet grid size-6 shrink-0 place-items-center" aria-label={`Remove ${name}`}>
    <X className="size-3.5" aria-hidden />
  </button>
</div>
```

Drop overlay: `pointer-events-none` absolute inset-0 on the card, `bg-amber/10` + `border-amber/40`, centered 13px text.

Paperclip sits immediately left of Send:

```tsx
<button type="button" onClick={() => fileInputRef.current?.click()} disabled={disabled} aria-label="Attach files" className="btn-quiet grid size-9 shrink-0 place-items-center disabled:opacity-60">
  <Paperclip className="size-4" aria-hidden />
</button>
<button type="button" onClick={() => void send()} ... className="btn-amber ml-auto grid size-9 ...">
```

Wait: if paperclip is before Send and Send has `ml-auto`, put paperclip **after** the branch label and **before** Send, with `ml-auto` on a wrapper around paperclip+send so they stay grouped on the right:

```tsx
<div className="ml-auto flex items-center gap-2">
  {/* paperclip */}
  {/* send */}
</div>
```

Remove `ml-auto` from the Send button itself.

---

## Self-review (controller)

- Spec: chips, paste, drop, paperclip, upload, disk storage, prompt appendix, Codex/OpenCode/Pi flags, message metadata, no project writes — each has a task.
- Queue native flags are explicitly deferred to the path appendix.
- Types: `attachmentIds`, `MessageAttachment`, `kind: "image" | "file"`.
