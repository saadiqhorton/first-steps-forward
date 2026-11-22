import { ChevronDown, Mic } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Dictation } from "@/lib/ade/dictation/useDictation";

const DEFAULT_MIC = "default";
const chevronClass =
  "grid h-9 w-5 shrink-0 place-items-center rounded-md bg-transparent text-dim transition-colors hover:bg-ink/[0.06] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/50 disabled:opacity-50 aria-expanded:bg-ink/[0.06] motion-reduce:transition-none";
const listeningClass =
  "relative grid size-9 shrink-0 place-items-center rounded-md bg-amber/15 text-amber transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/50 motion-reduce:transition-none";

/** Mic toggle plus a microphone picker for the composer's tool group. */
export function DictationControl({
  dictation,
  disabled,
  buttonClass,
  onToggle,
}: {
  dictation: Dictation;
  disabled: boolean;
  buttonClass: string;
  onToggle: () => void;
}) {
  const { active, support } = dictation;
  const label = active ? "Stop dictation" : "Start dictation";
  return (
    <div className="flex shrink-0 items-center">
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled && !active}
        aria-pressed={active}
        aria-label={label}
        title={label}
        className={active ? listeningClass : `relative ${buttonClass}`}
      >
        <Mic className="size-4" strokeWidth={1.5} aria-hidden />
        {active ? (
          <span
            className="absolute top-1.5 right-1.5 size-1.5 animate-pulse-soft rounded-full bg-amber"
            aria-hidden
          />
        ) : null}
      </button>
      {support?.ok ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={active}
              aria-label="Choose microphone"
              title="Choose microphone"
              className={chevronClass}
            >
              <ChevronDown className="size-3.5" strokeWidth={1.5} aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64 max-w-[calc(100vw-2rem)]">
            <DropdownMenuLabel className="text-xs text-dim">Microphone</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={dictation.selectedMic || DEFAULT_MIC}
              onValueChange={(value) => dictation.selectMic(value === DEFAULT_MIC ? "" : value)}
            >
              <DropdownMenuRadioItem value={DEFAULT_MIC}>System default</DropdownMenuRadioItem>
              {dictation.canPickMic
                ? dictation.mics.map((mic) => (
                    <DropdownMenuRadioItem key={mic.id} value={mic.id}>
                      <span className="min-w-0 truncate">{mic.label}</span>
                    </DropdownMenuRadioItem>
                  ))
                : null}
            </DropdownMenuRadioGroup>
            {dictation.savedMicMissing ? (
              <p className="px-2 py-1.5 text-xs leading-5 text-dim">
                Your saved microphone isn't connected. Dictation uses the system default until it's
                back.
              </p>
            ) : null}
            {!dictation.canPickMic ? (
              <>
                {dictation.mics.length && !dictation.labelsHidden ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-xs text-dim">Connected</DropdownMenuLabel>
                    {dictation.mics.map((mic) => (
                      <p key={mic.id} className="truncate px-2 py-1 text-xs leading-5 text-dim">
                        {mic.label}
                      </p>
                    ))}
                  </>
                ) : null}
                <p className="px-2 py-1.5 text-xs leading-5 text-dim">
                  Here the browser dictates from the device's current microphone. Switch it in this
                  device's sound or Bluetooth settings.
                </p>
              </>
            ) : null}
            {dictation.labelsHidden ? (
              <>
                <DropdownMenuSeparator />
                <p className="px-2 py-1.5 text-xs leading-5 text-dim">
                  Allow microphone access to see mic names.
                </p>
                <DropdownMenuItem
                  onSelect={(event) => {
                    event.preventDefault();
                    void dictation.requestMicAccess();
                  }}
                >
                  Allow microphone access
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
