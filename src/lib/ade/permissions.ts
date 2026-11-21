const PERMISSION_SHORT: Record<string, string> = {
  plan: "Read-only",
  build: "Ask",
  approve: "Auto-approve",
  full: "Full access",
  manual: "Manual",
  auto: "Auto",
  "dont-ask": "Don't ask",
  bypass: "Bypass",
};

/** A short, human label for a permission id, for places without the picker's notes. */
export function permissionShort(id: string): string {
  return PERMISSION_SHORT[id] ?? id;
}
