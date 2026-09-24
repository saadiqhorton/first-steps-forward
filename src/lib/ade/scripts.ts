import type { Approval, Check, FileChange, Project, Step } from "./types";

const FILESETS: Record<string, string[]> = {
  storefront: [
    "src/components/SaleBanner.tsx",
    "src/pages/Product.tsx",
    "src/styles/tokens.css",
    "src/components/Nav.tsx",
    "src/lib/cart.ts",
  ],
  docs: ["docs/getting-started.md", "src/layout/Sidebar.tsx", "src/theme.css", "docs/faq.md"],
  billing: ["src/routes/invoices.ts", "src/lib/tax.ts", "src/db/schema.sql", "tests/invoices.test.ts"],
};

function pick<T>(arr: T[], n: number, seed: number): T[] {
  const out: T[] = [];
  for (let i = 0; i < n && i < arr.length; i++) out.push(arr[(seed + i * 7) % arr.length]);
  return Array.from(new Set(out));
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function makeChanges(project: Project, request: string): FileChange[] {
  const key = Object.keys(FILESETS).find((k) => project.path.toLowerCase().includes(k)) ?? "storefront";
  const files = pick(FILESETS[key], 2 + (hash(request) % 2), hash(request));
  return files.map((path, i) => {
    const added = 6 + ((hash(path + request) + i) % 30);
    const removed = 1 + ((hash(request + path) + i) % 9);
    const short = request.length > 48 ? request.slice(0, 48) + "…" : request;
    return {
      path,
      added,
      removed,
      hunk: [
        `@@ -12,${removed + 3} +12,${added + 3} @@`,
        `  // ${short}`,
        `- const enabled = false;`,
        `+ const enabled = true;`,
        `+ const showOnMobile = window.matchMedia("(max-width: 640px)").matches;`,
        `  return (`,
        `-   <Banner />`,
        `+   <Banner compact={showOnMobile} enabled={enabled} />`,
        `  );`,
      ],
    };
  });
}

export function makeChecks(project: Project, failing: boolean): Check[] {
  const isApi = project.path.includes("billing");
  return [
    { name: "Typecheck", status: "passed", detail: "tsc --noEmit · 0 errors" },
    { name: "Lint", status: "passed", detail: "eslint · 0 warnings" },
    {
      name: isApi ? "Unit tests" : "Unit tests",
      status: failing ? "failed" : "passed",
      detail: failing ? "1 of 24 failed: tax rounding for CHF" : "24 passed",
    },
    {
      name: "End-to-end",
      status: "not_run",
      detail: "No e2e suite configured in this project",
    },
  ];
}

const RISKY = /\b(deploy|publish|release|production|prod|delete|drop|remove all|wipe|send email|charge)\b/i;

export function buildScript(project: Project, request: string, criteria: string): Step[] {
  const risky = RISKY.test(request);
  const asks = !criteria.trim();
  const changes = makeChanges(project, request);
  const failing = /\b(tax|billing|invoice)\b/i.test(request) && hash(request) % 2 === 0;
  const steps: Step[] = [];

  steps.push({
    kind: "say",
    delay: 1200,
    text: `Reading ${project.name} (${project.branch}) and the files related to your request. I'll keep changes limited to what you asked for.`,
  });

  if (asks) {
    steps.push({
      kind: "ask",
      delay: 1800,
      question: {
        text: "Should this also apply on small screens, or only on desktop?",
        options: ["Both", "Desktop only", "You decide"],
      },
    });
  }

  if (risky) {
    const approval: Approval = {
      action: /deploy|publish|release|prod/i.test(request) ? "Publish to an external environment" : "Delete files or data",
      target: project.name,
      scope: /deploy|publish|release|prod/i.test(request) ? "Production deployment target" : "Working tree and tracked files",
      risk: /deploy|publish|release|prod/i.test(request) ? "external" : "destructive",
      rollback: /deploy|publish|release|prod/i.test(request)
        ? "Previous deployment can be restored from the provider's history."
        : "Deleted files can be recovered from Git until you commit.",
    };
    steps.push({ kind: "approve", delay: 1500, approval });
  }

  steps.push({ kind: "say", delay: 1600, text: "Making the change now." });
  steps.push({ kind: "edit", delay: 2400, files: changes });
  steps.push({ kind: "verify", delay: 1400, checks: makeChecks(project, failing) });
  steps.push({
    kind: "ready",
    delay: 2600,
    summary: failing
      ? `Implemented the change across ${changes.length} files. One unit test failed, so this is not verified yet — see the checks for details.`
      : `Implemented the change across ${changes.length} files. Typecheck, lint, and unit tests passed. End-to-end tests were not run because none are configured.`,
  });

  return steps;
}

export function steerScript(text: string): Step[] {
  return [
    { kind: "say", delay: 1300, text: `Got it — adjusting: "${text}".` },
    { kind: "verify", delay: 1600, checks: [] },
    { kind: "ready", delay: 2200, summary: `Applied your follow-up. Checks re-ran and passed.` },
  ];
}
