import { useState } from "react";

// Shown when ADE is shared beyond this machine (`ade --remote`, or ADE_HOST +
// ADE_TOKEN) and this browser has not proven the token yet: POST /api/auth
// exchanges it for an HttpOnly cookie, then the provider's normal polling resumes.
// The sign-in link ADE prints does the same exchange without this form.
export function TokenGate({ onUnlocked }: { onUnlocked: () => Promise<void> }) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!token.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const value = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(value.error ?? "Incorrect access token.");
      await onUnlocked();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-panel p-6">
        <h1 className="text-xl font-medium">Unlock with the access token</h1>
        <p className="mt-2 text-ui leading-relaxed text-dim">
          This ADE is shared with your other devices. Open the sign-in link ADE printed when it
          started, or enter its access token here. This browser stays signed in.
        </p>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <input
            type="password"
            autoFocus
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Access token"
            className="w-full rounded-lg border border-line bg-background px-3 py-2 font-mono text-ui"
          />
          {error && (
            <p className="rounded bg-danger/10 p-2 text-(length:--text-xs) text-danger">{error}</p>
          )}
          <button
            type="submit"
            disabled={busy || !token.trim()}
            className="btn-amber w-full px-4 py-2 text-ui"
          >
            {busy ? "Checking…" : "Unlock ADE"}
          </button>
        </form>
      </div>
    </main>
  );
}
