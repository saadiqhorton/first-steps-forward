/** Build noVNC's authenticated WebSocket endpoint from ADE's loopback viewer URL. */
export function noVncWebSocketUrl(viewerUrl) {
  const endpoint = new URL(viewerUrl);
  endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
  if (!endpoint.pathname.startsWith("/websockify/")) {
    endpoint.pathname = "/websockify";
  }
  endpoint.search = "";
  endpoint.hash = "";
  return endpoint.toString();
}

export function noVncPassword(viewerUrl) {
  return new URL(viewerUrl).searchParams.get("password") ?? "";
}
