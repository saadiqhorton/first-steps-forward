/**
 * Scroll to the end with the next frame. `scrollIntoView` measures the page at
 * once, for every streamed piece; this waits for the layout the frame does anyway.
 * @returns cancels it, for an effect's cleanup
 */
export function scrollToEnd(scroller: HTMLElement | null) {
  if (!scroller) return undefined;
  const frame = requestAnimationFrame(() => {
    scroller.scrollTop = scroller.scrollHeight;
  });
  return () => cancelAnimationFrame(frame);
}
