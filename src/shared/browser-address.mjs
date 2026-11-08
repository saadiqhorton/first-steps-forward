// Adapted from T3 Code: packages/shared/src/preview.ts (resolveAddressBarInput).
// Copyright (c) 2026 T3 Tools Inc. MIT License; see THIRD_PARTY_NOTICES.md.
const HOST = /^(?:localhost|\d{1,3}(?:\.\d{1,3}){3}|\[[\da-f:.]+\])$/i;
const HOST_PORT = /^[^/?#:@]+:\d+(?:[/?#]|$)/;
const SCHEME = /^[a-z][a-z\d+.-]*:/i;
const AUTHORITY_SCHEME = /^[a-z][a-z\d+.-]*:\/\//i;
const NON_WEB_SCHEMES =
  /^(?:about|blob|chrome|data|file|ftp|javascript|mailto|sms|ssh|tel|view-source|ws|wss):/i;
const SEARCH_ENGINES = {
  duckduckgo: "https://duckduckgo.com/?q=%s",
  google: "https://www.google.com/search?q=%s",
  bing: "https://www.bing.com/search?q=%s",
  brave: "https://search.brave.com/search?q=%s",
  kagi: "https://kagi.com/search?q=%s",
  ecosia: "https://www.ecosia.org/search?q=%s",
};

export function isValidSearchUrlTemplate(template) {
  if (!template.includes("%s")) return false;
  try {
    const first = new URL(template.replaceAll("%s", "a"));
    const second = new URL(template.replaceAll("%s", "b"));
    return (
      ["http:", "https:"].includes(first.protocol) &&
      first.host === second.host &&
      first.username === second.username &&
      first.password === second.password
    );
  } catch {
    return false;
  }
}

export function resolveSearchUrlTemplate(engine, custom = "") {
  if (engine === "custom")
    return isValidSearchUrlTemplate(custom.trim()) ? custom.trim() : SEARCH_ENGINES.duckduckgo;
  return SEARCH_ENGINES[engine] ?? SEARCH_ENGINES.duckduckgo;
}

/** Return an address or turn ordinary words into a DuckDuckGo search. */
export function resolveAddressBarInput(input, template = "https://duckduckgo.com/?q=%s") {
  const text = String(input ?? "").trim();
  if (!text || AUTHORITY_SCHEME.test(text)) return text;
  if (!/\s/.test(text)) {
    if (NON_WEB_SCHEMES.test(text) || (SCHEME.test(text) && !HOST_PORT.test(text))) return text;
    const authority = text.split(/[/?#]/, 1)[0] ?? "";
    const withoutCredentials = authority.replace(/^[^@]*@/, "");
    const host = withoutCredentials.replace(/:\d+$/, "");
    if (
      host.length < withoutCredentials.length ||
      HOST.test(host) ||
      /^[^.]+(?:\.[^.]+)+\.?$/.test(host)
    )
      return text;
  }
  return template.replaceAll("%s", encodeURIComponent(text));
}
