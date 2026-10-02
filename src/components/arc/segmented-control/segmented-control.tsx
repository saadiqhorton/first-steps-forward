// @ts-nocheck -- vendored Arc source; it targets standard strict mode, not this repo's extra index and optional-property flags.
"use client";

import { useEffect, useId, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import { motionTokens } from "../lib/motion-tokens";
import styles from "./segmented-control.module.css";

export interface Segment { value: string; label: string; /** Optional content after the label, such as a badge. */ accessory?: ReactNode; }
export interface SegmentedControlProps {
  options: Segment[];
  value: string;
  onValueChange: (value: string) => void;
  label?: string;
  /** Called when the pointer or focus reaches an option, before it is chosen. Use it to start loading what that option shows. */
  onOptionIntent?: (value: string) => void;
  className?: string;
}

export default function SegmentedControl({ options, value, onValueChange, label, onOptionIntent, className }: SegmentedControlProps) {
  const id = useId();
  const reduced = useReducedMotion();
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; x: number; left: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  // When the options are wider than the container, the track scrolls inside itself. Edges fade only on the side with more to see.
  useLayoutEffect(() => {
    const node = track.current;
    if (!node) return;
    const edges = () => {
      const rest = node.scrollWidth - node.clientWidth - node.scrollLeft;
      node.toggleAttribute("data-fade-start", node.scrollLeft > 1);
      node.toggleAttribute("data-fade-end", rest > 1);
    };
    edges();
    node.addEventListener("scroll", edges, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(edges);
    observer?.observe(node);

    // Invisible side-scroll: map vertical wheel/trackpad to horizontal when there is overflow.
    const onWheel = (event: WheelEvent) => {
      if (node.scrollWidth <= node.clientWidth) return;
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (delta === 0) return;
      const max = node.scrollWidth - node.clientWidth;
      const next = Math.min(max, Math.max(0, node.scrollLeft + delta));
      if (next === node.scrollLeft) return;
      node.scrollLeft = next;
      event.preventDefault();
    };
    node.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      node.removeEventListener("scroll", edges);
      node.removeEventListener("wheel", onWheel);
      observer?.disconnect();
    };
  }, [options.length]);

  // Keep the selected option fully visible without a lagged smooth-scroll chase.
  useEffect(() => {
    const node = track.current;
    const button = node?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!node || !button || node.scrollWidth <= node.clientWidth) return;
    const room = 20, start = button.offsetLeft - room, end = button.offsetLeft + button.offsetWidth + room - node.clientWidth;
    const left = node.scrollLeft > start ? start : node.scrollLeft < end ? end : node.scrollLeft;
    if (left !== node.scrollLeft) node.scrollTo({ left: Math.max(0, left), behavior: "auto" });
  }, [value, reduced]);

  // Arrow keys, Home and End move the selection like a tab list; only the selected option is a tab stop.
  const selectedIndex = Math.max(0, options.findIndex(option => option.value === value));
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const last = options.length - 1;
    const target = event.key === "ArrowRight" || event.key === "ArrowDown" ? (selectedIndex === last ? 0 : selectedIndex + 1)
      : event.key === "ArrowLeft" || event.key === "ArrowUp" ? (selectedIndex === 0 ? last : selectedIndex - 1)
        : event.key === "Home" ? 0 : event.key === "End" ? last : -1;
    if (target < 0 || !options[target]) return;
    event.preventDefault();
    onValueChange(options[target].value);
    track.current?.querySelector<HTMLElement>(`[data-value="${CSS.escape(options[target].value)}"]`)?.focus({ preventScroll: true });
  };

  const onTrackPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const node = track.current;
    if (!node || event.button !== 0 || node.scrollWidth <= node.clientWidth) return;
    drag.current = { pointerId: event.pointerId, x: event.clientX, left: node.scrollLeft, moved: false };
  };

  const onTrackPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const node = track.current;
    const state = drag.current;
    if (!node || !state || state.pointerId !== event.pointerId) return;
    const dx = event.clientX - state.x;
    if (!state.moved && Math.abs(dx) < 4) return;
    if (!state.moved) {
      state.moved = true;
      node.setPointerCapture(event.pointerId);
      node.dataset.dragging = "true";
    }
    node.scrollLeft = state.left - dx;
    event.preventDefault();
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const node = track.current;
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    drag.current = null;
    if (state.moved) suppressClick.current = true;
    if (!node) return;
    if (node.hasPointerCapture(event.pointerId)) node.releasePointerCapture(event.pointerId);
    delete node.dataset.dragging;
  };

  const onOptionClick = (event: React.MouseEvent<HTMLButtonElement>, next: string) => {
    // A drag-scroll gesture should not also select the option under the pointer.
    if (suppressClick.current) {
      suppressClick.current = false;
      event.preventDefault();
      return;
    }
    onValueChange(next);
  };

  return <div className={`${styles.root} ${className ?? ""}`} role="group" aria-label={label}>
    <LayoutGroup id={id}><motion.div
      ref={track}
      layoutScroll
      className={styles.track}
      onPointerDown={onTrackPointerDown}
      onPointerMove={onTrackPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {options.map((option, index) => <button key={option.value} id={`${id}-${option.value}`} className={styles.button} type="button" data-value={option.value} aria-pressed={value === option.value} tabIndex={index === selectedIndex ? 0 : -1} onClick={(event) => onOptionClick(event, option.value)} onKeyDown={onKeyDown} onPointerEnter={onOptionIntent ? () => onOptionIntent(option.value) : undefined} onFocus={onOptionIntent ? () => onOptionIntent(option.value) : undefined}>
        {value === option.value && <motion.span className={styles.selection} layoutId="selection" layoutDependency={value} transition={reduced ? { duration: 0 } : motionTokens.spring.morph} aria-hidden="true" />}
        <span className={styles.label}>{option.label}{option.accessory}</span>
      </button>)}
    </motion.div></LayoutGroup>
  </div>;
}
