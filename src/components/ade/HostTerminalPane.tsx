import { FitAddon } from "@xterm/addon-fit";
import type { ILink, Terminal } from "@xterm/xterm";
import { useXTerm } from "react-xtermjs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { request } from "@/lib/ade/api";
import { requestPreviewOpen } from "@/lib/ade/browser/openInPreview.mjs";

type Props = {
  projectId: string;
  projectName: string;
  projectPath: string;
  visible: boolean;
  registerClose: (close: (() => Promise<void>) | null) => void;
};
type Session = { id: string; shell: string; cwd: string };
type Output = {
  data: string;
  cursor: number;
  truncated: boolean;
  hasMore: boolean;
  exited: boolean;
  exitCode: number | null;
};

function nextPollDelay(output: Output, elapsed: number) {
  // An empty body that comes back immediately means wait was ignored.
  // Keep the old idle pace so that cannot spin the event loop.
  return !output.data && !output.hasMore && elapsed < 30 ? 150 : 0;
}

const URL_IN_LINE = /\bhttps?:\/\/[^\s"'<>]+/g;

/** Every http(s) URL on a printed line becomes a link, as T3's terminal has. */
function terminalLinks(instance: Terminal) {
  return {
    provideLinks(lineNumber: number, callback: (links: ILink[] | undefined) => void) {
      const line = instance.buffer.active.getLine(lineNumber - 1)?.translateToString(true);
      if (!line) return callback(undefined);
      const links: ILink[] = [];
      for (const match of line.matchAll(URL_IN_LINE)) {
        const text = match[0].replace(/[.,;:)\]'"]+$/, "");
        const start = (match.index ?? 0) + 1;
        links.push({
          text,
          range: {
            start: { x: start, y: lineNumber },
            end: { x: start + text.length - 1, y: lineNumber },
          },
          activate: (event, linkText) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || !requestPreviewOpen(linkText))
              window.open(linkText, "_blank", "noopener,noreferrer");
          },
        });
      }
      callback(links.length ? links : undefined);
    },
    dispose() {
      // Nothing to release: links are computed from the buffer on demand.
    },
  };
}

const options = {
  fontFamily: '"IBM Plex Mono", monospace',
  fontSize: 12,
  lineHeight: 1.45,
  cursorBlink: true,
  cursorStyle: "block" as const,
  scrollback: 3000,
  theme: {
    background: "#171715",
    foreground: "#e9ece3",
    cursor: "#e1ad61",
    selectionBackground: "#79aaa455",
    black: "#171715",
    green: "#8dc4b7",
    yellow: "#e1ad61",
    brightBlack: "#9fb0aa",
  },
};

export function HostTerminalPane({
  projectId,
  projectName,
  projectPath,
  visible,
  registerClose,
}: Props) {
  const fitAddon = useMemo(() => new FitAddon(), []);
  const addons = useMemo(() => [fitAddon], [fitAddon]);
  const sessionRef = useRef<string | null>(null);
  const openingRef = useRef<Promise<Session> | null>(null);
  const sendChain = useRef<Promise<unknown>>(Promise.resolve());
  const pendingInput = useRef("");
  const inputTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<"connecting" | "connected" | "exited" | "error">(
    "connecting",
  );
  const [message, setMessage] = useState("");
  const [shell, setShell] = useState("");
  const [generation, setGeneration] = useState(0);

  const flushInput = useCallback(() => {
    if (inputTimer.current) clearTimeout(inputTimer.current);
    inputTimer.current = null;
    const id = sessionRef.current;
    if (!id) {
      pendingInput.current = "";
      return;
    }
    while (pendingInput.current) {
      const data = pendingInput.current.slice(0, 8192);
      pendingInput.current = pendingInput.current.slice(8192);
      sendChain.current = sendChain.current
        .catch(() => undefined)
        .then(() => request(`/api/terminal/${id}/input`, "POST", { data }))
        .catch((error) => {
          setMessage(error instanceof Error ? error.message : String(error));
        });
    }
  }, []);
  const onData = useCallback(
    (data: string) => {
      if (!sessionRef.current) return;
      pendingInput.current += data;
      if (data.includes("\r") || pendingInput.current.length >= 8192) flushInput();
      else if (!inputTimer.current) inputTimer.current = setTimeout(flushInput, 16);
    },
    [flushInput],
  );
  const listeners = useMemo(() => ({ onData }), [onData]);
  const { ref, instance } = useXTerm({ options, addons, listeners });

  // Links printed by the shell open in ADE's browser, or the system browser with a modifier.
  useEffect(() => {
    if (!instance) return;
    const provider = instance.registerLinkProvider(terminalLinks(instance));
    return () => provider.dispose();
  }, [instance]);

  useEffect(() => {
    registerClose(async () => {
      if (!sessionRef.current && openingRef.current) {
        try {
          await openingRef.current;
        } catch {
          // A failed open did not create a shell to close.
          return;
        }
      }
      const id = sessionRef.current;
      if (!id) return;
      try {
        await request(`/api/terminal/${id}/close`, "POST", {});
      } catch (error) {
        if ((error as Error & { status?: number }).status !== 404) throw error;
      }
      sessionRef.current = null;
    });
    return () => registerClose(null);
  }, [registerClose]);

  useEffect(() => {
    if (!instance || !projectId || !ref.current) return;
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const pollAbort = new AbortController();
    let currentId: string | null = null;
    let cursor = 0;
    setStatus("connecting");
    setMessage("");

    const fit = () => {
      if (!ref.current?.clientWidth || !ref.current?.clientHeight) return;
      fitAddon.fit();
      if (currentId) {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          if (!cancelled && currentId)
            void request(`/api/terminal/${currentId}/resize`, "POST", {
              cols: instance.cols,
              rows: instance.rows,
            }).catch(() => undefined);
        }, 100);
      }
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(ref.current);
    const closeOnPageHide = () => {
      if (!currentId) return;
      const id = currentId;
      currentId = null;
      sessionRef.current = null;
      const payload = new Blob(["{}"], { type: "application/json" });
      if (!navigator.sendBeacon(`/api/terminal/${id}/close`, payload))
        void fetch(`/api/terminal/${id}/close`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
          keepalive: true,
        }).catch(() => undefined);
    };
    window.addEventListener("pagehide", closeOnPageHide);

    const poll = async () => {
      if (!currentId || cancelled) return;
      const started = performance.now();
      let output: Output;
      try {
        // The shell echoes each key. Hold this read until that echo arrives
        // instead of sampling on a timer, which is what made typing lag.
        output = await request<Output>(
          `/api/terminal/${currentId}?cursor=${cursor}&wait=1000`,
          "GET",
          undefined,
          { signal: pollAbort.signal },
        );
      } catch (error) {
        if (cancelled || (error instanceof Error && error.name === "AbortError")) return;
        setStatus("error");
        setMessage(error instanceof Error ? error.message : String(error));
        return;
      }
      if (cancelled) return;
      if (output.truncated) instance.writeln("\r\n[Earlier output was discarded]\r");
      if (output.data) instance.write(output.data);
      cursor = output.cursor;
      if (output.exited && !output.hasMore) {
        const finishedId = currentId;
        currentId = null;
        sessionRef.current = null;
        if (finishedId)
          void request(`/api/terminal/${finishedId}/close`, "POST", {}).catch(() => undefined);
        setStatus("exited");
        setMessage(`Shell exited with code ${output.exitCode ?? "unknown"}.`);
        return;
      }
      pollTimer = setTimeout(poll, nextPollDelay(output, performance.now() - started));
    };

    const opening = request<Session>("/api/terminal", "POST", {
      projectId,
      cols: Math.max(20, instance.cols),
      rows: Math.max(5, instance.rows),
    });
    openingRef.current = opening;
    void opening
      .then((session) => {
        if (cancelled) {
          void request(`/api/terminal/${session.id}/close`, "POST", {}).catch(() => undefined);
          return;
        }
        currentId = session.id;
        sessionRef.current = session.id;
        setShell(session.shell);
        setStatus("connected");
        instance.clear();
        fit();
        void poll();
      })
      .catch((error) => {
        if (!cancelled) {
          setStatus("error");
          setMessage(error instanceof Error ? error.message : String(error));
        }
      });

    return () => {
      cancelled = true;
      pollAbort.abort();
      if (openingRef.current === opening) openingRef.current = null;
      observer.disconnect();
      window.removeEventListener("pagehide", closeOnPageHide);
      clearTimeout(pollTimer);
      clearTimeout(resizeTimer);
      pendingInput.current = "";
      if (inputTimer.current) clearTimeout(inputTimer.current);
      inputTimer.current = null;
      if (currentId && sessionRef.current === currentId) {
        sessionRef.current = null;
        void fetch(`/api/terminal/${currentId}/close`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
          keepalive: true,
        }).catch(() => undefined);
      }
    };
  }, [instance, projectId, generation, fitAddon, ref]);

  useEffect(() => {
    if (visible && instance) {
      requestAnimationFrame(() => {
        if (ref.current?.clientWidth) fitAddon.fit();
        instance.focus();
      });
    }
  }, [visible, instance, fitAddon, ref]);

  return (
    <section
      className="host-terminal flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden bg-[#171715] text-[#e9ece3]"
      aria-label="Host terminal"
    >
      <div className="shrink-0 border-b border-white/10 px-3 py-3">
        <div className="truncate text-base font-medium leading-tight" title={projectName}>
          {projectName}
        </div>
      </div>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 px-3 py-2 font-mono text-[10px]">
        <span className="truncate text-[#e1ad61]">›_ {shell || "Console"}</span>
        <div className="flex shrink-0 items-center gap-2">
          <span className={status === "connected" ? "text-[#8dc4b7]" : "text-white/50"}>
            {status === "connected" ? "● Live" : status.charAt(0).toUpperCase() + status.slice(1)}
          </span>
        </div>
      </div>
      <div className="min-h-0 min-w-0 flex-1 py-3 pl-3">
        <div ref={ref} className="h-full w-full min-w-0" aria-label="Interactive host terminal" />
      </div>
      <div className="shrink-0 border-t border-white/10 px-3 py-2">
        <div className="flex items-center justify-between gap-2 font-mono text-[10px]">
          <span className="min-w-0 truncate text-white/45" title={projectPath}>
            {projectPath}
          </span>
          {(status === "exited" || status === "error") && (
            <button
              type="button"
              className="shrink-0 text-[#e1ad61] hover:underline"
              onClick={() => {
                setGeneration((n) => n + 1);
              }}
            >
              New shell
            </button>
          )}
        </div>
        {message && (
          <div role="status" className="mt-1 font-mono text-[10px] text-[#e1ad61]">
            {message}
          </div>
        )}
      </div>
    </section>
  );
}
