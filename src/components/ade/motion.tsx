import { motion, useReducedMotion } from "motion/react";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { motionTokens } from "@/components/arc/motion-tokens";

const exitTween = {
  duration: motionTokens.duration.exit,
  ease: [...motionTokens.ease.exit],
} as const;

/** A list or grid item that rises in, slides to its new place when siblings change, and fades out.
 *  Render inside <AnimatePresence initial={false} mode="popLayout"> with a stable key.
 *  Pass enter={false} for items that were there already and are only now rendered.
 *  Pass layout={false} for append-only lists such as a chat thread, where siblings never reorder. */
export function MotionItem({
  children,
  className,
  layout = true,
  enter = true,
}: {
  children: ReactNode;
  className?: string;
  layout?: boolean;
  enter?: boolean;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      layout={reduce || !layout ? false : "position"}
      initial={!enter ? false : reduce ? { opacity: 0 } : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: exitTween }}
      transition={reduce ? { duration: 0 } : motionTokens.spring.smooth}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/** A selection mark that glides between siblings sharing the same id. Render it only inside the active item. */
export function GlideIndicator({
  id,
  className,
  spring = "morph",
}: {
  id: string;
  className: string;
  spring?: "morph" | "snappy";
}) {
  const reduce = useReducedMotion();
  return (
    <motion.span
      layoutId={id}
      className={className}
      transition={reduce ? { duration: 0 } : motionTokens.spring[spring]}
      aria-hidden
    />
  );
}

/** Fades a page section in when `sectionKey` changes. Enter-only, so it never delays navigation. */
export function SectionFade({
  sectionKey,
  children,
  className,
}: {
  sectionKey: string;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (preference.matches || !ref.current) return;
    // Keep the route subtree mounted and let the browser run the entrance
    // animation without waiting for Motion's next JavaScript animation frame.
    const animation = ref.current.animate(
      [
        { opacity: 0, transform: "translateY(6px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      {
        duration: motionTokens.duration.standard * 1000,
        easing: `cubic-bezier(${motionTokens.ease.enter.join(",")})`,
      },
    );
    const onPreferenceChange = () => {
      if (preference.matches) animation.cancel();
    };
    preference.addEventListener("change", onPreferenceChange);
    return () => {
      preference.removeEventListener("change", onPreferenceChange);
      animation.cancel();
    };
  }, [sectionKey]);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}

/** A side pane that slides in from the edge it is attached to. Render inside <AnimatePresence>. */
export function MotionPane({
  children,
  className,
  from = "right",
}: {
  children: ReactNode;
  className?: string;
  from?: "left" | "right";
}) {
  const reduce = useReducedMotion();
  const offset = from === "right" ? 24 : -24;
  return (
    <motion.div
      initial={reduce ? { opacity: 0 } : { opacity: 0, x: offset }}
      animate={{ opacity: 1, x: 0 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, x: offset, transition: exitTween }}
      transition={reduce ? { duration: 0 } : motionTokens.spring.smooth}
      className={className}
    >
      {children}
    </motion.div>
  );
}
