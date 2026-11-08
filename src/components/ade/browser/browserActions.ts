/** Open a page's address in the person's own browser. Only http(s) addresses are opened. */
export function openExternally(url: string | undefined): void {
  if (!url || !/^https?:\/\//i.test(url)) return;
  window.open(url, "_blank", "noopener,noreferrer");
}
