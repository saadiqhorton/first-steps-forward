import { ExternalLink } from "lucide-react";
import { requestPreviewOpen } from "@/lib/ade/browser/openInPreview.mjs";

function shortAddress(address: string | null) {
  return address ? address.replace(/^https?:\/\//, "").replace(/\/$/, "") : "Address unavailable";
}

/** A read-only row for ADE itself: this window, or another ADE on loopback. */
export function AdeRow({
  name,
  note,
  address,
}: {
  name: string;
  note: string;
  address: string | null;
}) {
  return (
    <button
      type="button"
      disabled={!address}
      onClick={() => address && requestPreviewOpen(address)}
      title={address ? `Open ${address}` : undefined}
      aria-label={address ? `Open ${name} at ${address}` : `${name}, address unavailable`}
      className="flex min-h-12 w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors hover:bg-ink/[0.03] disabled:hover:bg-transparent"
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-teal" />
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="truncate text-[12.5px] font-medium leading-[18px] tracking-normal">
          {name}
        </span>
        <span className="flex min-w-0 items-center justify-between gap-2 font-mono text-[10.5px] leading-4 tracking-normal text-dim">
          <span className="truncate">{shortAddress(address)}</span>
          <span className="shrink-0">{note}</span>
        </span>
      </span>
      <ExternalLink className="size-3.5 shrink-0 text-dim" strokeWidth={1.75} aria-hidden />
    </button>
  );
}
