# Routes

ADE uses TanStack Router's file-based routes. Route files live in this directory;
the router plugin generates `src/routeTree.gen.ts` from their `createFileRoute`
paths. Do not edit the generated file by hand.

## Naming and nesting

This project uses dot-separated filenames for nested routes. A `$name` segment
is dynamic, and `.index` adds the index route under its parent. Parent route
files can render child routes through `<Outlet />`.

| File | Route path | Purpose |
| --- | --- | --- |
| `__root.tsx` | root | App shell and the root `<Outlet />` |
| `index.tsx` | `/` | Main workspace entry |
| `workspace.tsx` | `/workspace` | Workspace layout |
| `workspace.index.tsx` | `/workspace/` | Workspace index |
| `p.$projectId.tsx` | `/p/$projectId` | Project layout |
| `p.$projectId.index.tsx` | `/p/$projectId/` | Project index |
| `p.$projectId.conversations.$sessionId.tsx` | `/p/$projectId/conversations/$sessionId` | A project's selected session |

The `createFileRoute` path in each file is the route's source of truth; follow
the existing naming pattern when adding a route, then let the plugin regenerate
the route tree. Preserve `<Outlet />` in `__root.tsx` and in any parent route
that has children, or those child pages will not render.
