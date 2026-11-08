// Adapted from T3 Code's PreviewUnreachable.tsx and previewConstants.ts.
// Copyright (c) 2026 T3 Tools Inc. MIT License; see THIRD_PARTY_NOTICES.md.
import { useState } from "react";
import { FileWarning } from "lucide-react";
import type { BrowserNavigationError } from "@/lib/ade/browser/browserStream";

const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  ERR_NAME_NOT_RESOLVED: "DNS address could not be found",
  ERR_NAME_RESOLUTION_FAILED: "DNS address could not be found",
  ERR_CONNECTION_REFUSED: "Connection refused",
  ERR_CONNECTION_RESET: "Connection was reset",
  ERR_CONNECTION_CLOSED: "Connection was closed",
  ERR_CONNECTION_TIMED_OUT: "Connection timed out",
  ERR_INTERNET_DISCONNECTED: "No internet connection",
  ERR_TIMED_OUT: "Connection timed out",
  ERR_CERT_AUTHORITY_INVALID: "Certificate authority is not trusted",
  ERR_CERT_COMMON_NAME_INVALID: "Certificate hostname mismatch",
  ERR_CERT_DATE_INVALID: "Certificate is expired or not yet valid",
  ERR_TOO_MANY_REDIRECTS: "Too many redirects",
};

export function BrowserUnreachable({
  error,
  onReload,
}: {
  error: BrowserNavigationError;
  onReload: () => void;
}) {
  const [showDetails, setShowDetails] = useState(false);
  let host = error.url;
  try {
    host = new URL(error.url).host || error.url;
  } catch {
    // Keep the attempted address when it is not a valid URL.
  }
  const code = /ERR_[A-Z_]+/.exec(error.description)?.[0] ?? error.description;
  return (
    <div className="absolute inset-0 z-[4] overflow-y-auto bg-paper text-ink" role="alert">
      <div className="mx-auto flex min-h-full w-full max-w-xl flex-col px-6 py-8">
        <FileWarning className="mb-5 size-10 text-dim" aria-hidden />
        <h2 className="mb-3 text-xl font-semibold">This site can’t be reached</h2>
        <p className="text-sm text-dim">
          <span className="font-semibold text-ink">{host}</span>:{" "}
          {ERROR_MESSAGES[code] ?? (code || "Network error")}.
        </p>
        {showDetails ? (
          <div className="mt-5 rounded-lg border border-line bg-panel p-3 text-xs text-dim">
            <p className="mb-2 font-medium text-ink">Try:</p>
            <ul className="list-disc space-y-1 pl-4">
              <li>Checking your connection</li>
              <li>Confirming the development server is running</li>
              <li>Checking the proxy and firewall</li>
            </ul>
          </div>
        ) : null}
        <p className="mt-6 text-xs text-dim">{code || "ERR_FAILED"}</p>
        <div className="mt-auto flex gap-2 pt-6">
          <button
            type="button"
            className="btn-quiet px-3 py-1.5 text-xs"
            onClick={() => setShowDetails((value) => !value)}
          >
            {showDetails ? "Hide details" : "Details"}
          </button>
          <button
            type="button"
            className="btn-amber ml-auto px-3 py-1.5 text-xs"
            onClick={onReload}
          >
            Reload
          </button>
        </div>
      </div>
    </div>
  );
}
