// Stable id for this page load. The stream server uses it to tell viewers apart, so one
// window's control grant is not confused with another window's.

let viewerId: string | null = null;

function newId(): string {
  // randomUUID exists only in secure contexts, and ADE can be opened over plain http on a LAN.
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The viewer id for this page load. Generated once, then reused. */
export function browserViewerId(): string {
  viewerId ??= newId();
  return viewerId;
}
