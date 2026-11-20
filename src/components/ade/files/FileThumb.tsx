import {
  File,
  FileArchive,
  FileAudio,
  FileCode2,
  FileImage,
  FileTerminal,
  FileText,
  FileVideo,
  Pause,
  Play,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { editorRawUrl, type EditorEntry, type EntryPreview } from "@/lib/ade/editorApi";
import { mediaKindOf } from "@/shared/media-types.mjs";
import { stopSound, toggleSound, useSoundPlaying } from "./sharedSound";

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_WAVEFORM_BYTES = 12 * 1024 * 1024;
const WAVEFORM_BARS = 16;
/** Bar heights shown until (or instead of) the decoded peaks. */
const RESTING_WAVE = [
  0.3, 0.5, 0.42, 0.7, 0.55, 0.85, 0.6, 0.4, 0.65, 0.9, 0.5, 0.35, 0.6, 0.45, 0.3, 0.2,
];

const PAGE = "h-[60px] w-[46px] overflow-hidden rounded-[3px] border border-line";

const CODE_EXTENSIONS = new Set(
  "ts tsx js jsx mjs cjs json jsonc html htm css scss sass less vue svelte astro py rb go rs java kt swift c h cc cpp hpp cs php lua sql graphql yml yaml toml xml ini lock".split(
    " ",
  ),
);
const ARCHIVE_EXTENSIONS = new Set("zip tar gz tgz bz2 xz 7z rar zst jar".split(" "));
const DOCUMENT_EXTENSIONS = new Set("pdf doc docx odt rtf txt md mdx csv tsv".split(" "));
const SHELL_EXTENSIONS = new Set("sh bash zsh fish ps1 psm1 bat cmd".split(" "));

function extensionOf(name: string) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function glyphFor(name: string): LucideIcon {
  const media = mediaKindOf(name);
  if (media === "image") return FileImage;
  if (media === "video") return FileVideo;
  if (media === "audio") return FileAudio;
  const ext = extensionOf(name);
  if (CODE_EXTENSIONS.has(ext)) return FileCode2;
  if (ARCHIVE_EXTENSIONS.has(ext)) return FileArchive;
  if (DOCUMENT_EXTENSIONS.has(ext)) return FileText;
  if (SHELL_EXTENSIONS.has(ext)) return FileTerminal;
  return File;
}

/** Mounts expensive previews only once their tile scrolls near the viewport. */
function useNearViewport(ref: RefObject<Element | null>) {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node || near) return;
    const observer = new IntersectionObserver(
      (records) => {
        if (records.some((record) => record.isIntersecting)) setNear(true);
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [near, ref]);
  return near;
}

export function FolderThumb({ tone }: { tone: string }) {
  // Settling the tone into the page keeps the -deep tokens from glaring in dark mode and from
  // reading as near-black in light mode; the back panel is the same color a step darker.
  const front = `color-mix(in oklab, ${tone} var(--folder-mix), var(--paper))`;
  return (
    <svg
      width="56"
      height="44"
      viewBox="0 0 56 44"
      aria-hidden
      className="[--folder-mix:66%] dark:[--folder-mix:85%]"
    >
      <path
        d="M0 3a3 3 0 0 1 3-3h15.6a3 3 0 0 1 2.1.9l3.8 3.8a3 3 0 0 0 2.1.9H53a3 3 0 0 1 3 3V41a3 3 0 0 1-3 3H3a3 3 0 0 1-3-3Z"
        style={{ fill: `color-mix(in oklab, ${front} 80%, black)` }}
      />
      <rect y="9" width="56" height="35" rx="3" style={{ fill: front }} />
    </svg>
  );
}

function BlankPage() {
  return <div className={`${PAGE} bg-[var(--code-background)]`} />;
}

function TextPage({ text }: { text: string }) {
  return (
    <div className={`${PAGE} bg-[var(--code-background)] px-[3px] py-[4px]`}>
      {/* Laid out at twice the size and scaled down, so the lines read as texture
          without hitting the browser's minimum font size. */}
      <div className="w-[200%] origin-top-left scale-50 text-left font-mono text-[7px] leading-[1.35] whitespace-pre-wrap text-[var(--code-foreground)] [overflow-wrap:anywhere]">
        {text}
      </div>
    </div>
  );
}

function GenericPage({ name }: { name: string }) {
  const Glyph = glyphFor(name);
  const ext = extensionOf(name);
  const tag = ext && ext.length <= 4 ? ext.toUpperCase() : "FILE";
  return (
    <div className="relative h-[52px] w-[40px]">
      <svg width="40" height="52" viewBox="0 0 40 52" aria-hidden className="absolute inset-0">
        <path
          d="M3.5.5H27L39.5 13v35.5a3 3 0 0 1-3 3h-33a3 3 0 0 1-3-3v-45a3 3 0 0 1 3-3Z"
          style={{ fill: "var(--code-background)", stroke: "var(--line)" }}
        />
        <path
          d="M27 .5V10a3 3 0 0 0 3 3h9.5"
          style={{
            fill: "color-mix(in oklab, var(--line) 55%, var(--code-background))",
            stroke: "var(--line)",
            strokeLinejoin: "round",
          }}
        />
      </svg>
      <span className="absolute inset-x-0 top-[17px] flex flex-col items-center gap-[5px] text-dim">
        <Glyph size={13} strokeWidth={1.75} aria-hidden />
        <span className="font-mono text-[8px] leading-none">{tag}</span>
      </span>
    </div>
  );
}

const FRAME = "max-h-16 max-w-16 rounded-[4px] border border-line object-contain";

function VideoThumb({ url, onFail }: { url: string; onFail: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const near = useNearViewport(ref);
  const [duration, setDuration] = useState<number | null>(null);
  return (
    <div ref={ref} className="flex h-16 w-16 items-center justify-center">
      {near ? (
        <span className="relative inline-flex">
          <video
            src={`${url}#t=0.5`}
            preload="metadata"
            muted
            playsInline
            tabIndex={-1}
            onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
            onError={onFail}
            className={`${FRAME} bg-deck`}
          />
          {duration != null && Number.isFinite(duration) && (
            <span className="absolute right-1 bottom-1 rounded-[3px] bg-deck/85 px-1 font-mono text-3xs leading-[13px] text-deck-foreground">
              {formatDuration(duration)}
            </span>
          )}
        </span>
      ) : (
        <span className="h-10 w-16 rounded-[4px] border border-line bg-deck" />
      )}
    </div>
  );
}

function formatDuration(seconds: number) {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, "0")}`;
}

const waveforms = new Map<string, Promise<number[] | null>>();

function loadWaveform(url: string) {
  let pending = waveforms.get(url);
  if (!pending) {
    pending = (async () => {
      try {
        const response = await fetch(url);
        if (!response.ok) return null;
        // A one-frame offline context only decodes; it never touches the audio device.
        const decoded = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(
          await response.arrayBuffer(),
        );
        const samples = decoded.getChannelData(0);
        const bucket = Math.max(1, Math.floor(samples.length / WAVEFORM_BARS));
        const stride = Math.max(1, Math.floor(bucket / 4096));
        const peaks: number[] = [];
        for (let bar = 0; bar < WAVEFORM_BARS; bar++) {
          let peak = 0;
          const end = Math.min(samples.length, (bar + 1) * bucket);
          for (let i = bar * bucket; i < end; i += stride) {
            peak = Math.max(peak, Math.abs(samples[i] ?? 0));
          }
          peaks.push(peak);
        }
        const loudest = Math.max(...peaks);
        return loudest > 0 ? peaks.map((peak) => peak / loudest) : null;
      } catch {
        return null;
      }
    })();
    waveforms.set(url, pending);
  }
  return pending;
}

function AudioThumb({ url, size }: { url: string; size: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const near = useNearViewport(ref);
  const playing = useSoundPlaying(url);
  const [peaks, setPeaks] = useState<number[] | null>(null);

  useEffect(() => {
    if (!near || size > MAX_WAVEFORM_BYTES) return;
    let live = true;
    void loadWaveform(url).then((result) => {
      if (live) setPeaks(result);
    });
    return () => {
      live = false;
    };
  }, [near, size, url]);

  const bars = peaks ?? RESTING_WAVE;
  return (
    <div
      ref={ref}
      className={`${PAGE} flex items-center justify-center gap-px bg-[var(--code-background)] ${
        playing ? "text-amber-deep" : "text-dim"
      }`}
    >
      {bars.map((height, index) => (
        <span
          key={index}
          className={`w-[1.5px] rounded-full bg-current ${peaks ? "" : "opacity-40"}`}
          style={{ height: `${Math.max(2, Math.round(height * 22))}px` }}
        />
      ))}
    </div>
  );
}

type ThumbProps = {
  projectId: string;
  entry: EditorEntry;
  preview: EntryPreview | undefined;
  /** Previews still loading: draw a blank page so a text file never flashes the generic icon. */
  pending: boolean;
};

export function FileThumb({ projectId, entry, preview, pending }: ThumbProps) {
  const [failed, setFailed] = useState(false);
  if (pending) return <BlankPage />;
  if (!preview || failed) return <GenericPage name={entry.name} />;
  if (preview.media) {
    const url = editorRawUrl(projectId, entry.path, preview.modifiedAt);
    if (preview.media === "image" && preview.size <= MAX_IMAGE_BYTES)
      return (
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailed(true)}
          className={FRAME}
        />
      );
    if (preview.media === "video") return <VideoThumb url={url} onFail={() => setFailed(true)} />;
    if (preview.media === "audio") return <AudioThumb url={url} size={preview.size} />;
  }
  if (preview.text) return <TextPage text={preview.text} />;
  return <GenericPage name={entry.name} />;
}

export function SoundButton({
  projectId,
  entry,
  preview,
}: {
  projectId: string;
  entry: EditorEntry;
  preview: EntryPreview;
}) {
  const url = editorRawUrl(projectId, entry.path, preview.modifiedAt);
  const playing = useSoundPlaying(url);
  useEffect(() => () => stopSound(url), [url]);
  const Icon = playing ? Pause : Play;
  return (
    <button
      type="button"
      aria-label={`${playing ? "Pause" : "Play"} ${entry.name}`}
      title={playing ? "Pause" : "Play"}
      onClick={() => toggleSound(url)}
      className={`absolute top-[26px] left-1/2 grid size-7 -translate-x-1/2 place-items-center rounded-full bg-deck/85 text-deck-foreground transition-opacity group-hover:opacity-100 group-has-[:focus-visible]:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-amber/50 focus-visible:outline-none [@media(hover:none)]:opacity-100 ${
        playing ? "opacity-100" : "opacity-0"
      }`}
    >
      <Icon size={12} aria-hidden fill="currentColor" strokeWidth={0} />
    </button>
  );
}
