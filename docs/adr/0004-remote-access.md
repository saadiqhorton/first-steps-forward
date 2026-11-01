# 0004: Remote access with one flag, on the local network by default

**Status:** accepted, 2026-11-01.

## Context

People want to check on or drive ADE from a phone or another computer. ADE could already listen
beyond loopback, but only by hand: choose an address for `ADE_HOST`, generate an `ADE_TOKEN`,
optionally run `tailscale serve` in front, and type the token into each browser. `ade --host`
looked like a shortcut but bound the address without telling the request guard, so every remote
request was refused. And behind `tailscale serve` the guard trusted the proxy completely, which
admits everyone on the tailnet, not just its owner; ADE can run agents and change files on the
host, so that is too much trust for a tailnet shared with other people.

## Decisions

### One flag, nothing to configure

`ade --remote` makes an access token once, keeps it in `~/.ade/remote-token` (mode 0600), and
reuses it on every start, so a printed link and every signed-in browser keep working across
restarts. Deleting the file signs every device out. A token set in `ADE_TOKEN` is used instead.

### The local network by default; Tailscale is an extra

ADE listens on every interface and prints a sign-in link for each local-network address. The link
is plain HTTP, and the output says it suits a home network, not public Wi-Fi. Nothing else is
required: no account, relay, or extra software.

When Tailscale is already connected, ADE also prints a tailnet link. If the tailnet has HTTPS
certificates on, ADE runs `tailscale serve` in the foreground for as long as it runs, so the link
is HTTPS and the share disappears when ADE exits; otherwise the link is the plain tailnet address.
A failed share falls back to that address silently, because the Wi-Fi link still works.

### The token gates every remote path

Every request that does not come from this machine must prove the token, including requests a
local proxy forwards whenever a token is set. Without a token, a proxy is still the only gate, as
before. Loopback clients (this machine's browser and the agent CLIs) stay exempt. Host tools (the
terminal, file editor, and agent CLI installs) stay loopback-only even for a signed-in device.
`ade --host` now sets `ADE_HOST` for the guard as well as the bind.

### The sign-in link is the app's own address

The link is any ADE page with `?token=…`. The server checks it, sets the same `HttpOnly` cookie as
`POST /api/auth`, and redirects to the same page without the token, so the token does not stay in
the address bar. A wrong token redirects too, without the cookie, and the app shows its unlock
screen. The redirect only ever targets a path on the same host.

### Not reachable from the internet without Tailscale

ADE does not open a public tunnel or relay. Reaching ADE away from home requires Tailscale (or a
setup the user builds themselves), keeping the self-hosted, no-relay principle.

## Consequences

- The common case is one command and one link per device.
- On a local network the token travels in plain HTTP; anyone who can read that traffic, or who
  gets the link, can use ADE until `~/.ade/remote-token` is deleted.
- Guest and office networks that isolate devices, and host firewalls, can block the Wi-Fi link;
  ADE cannot detect that, so the README lists what to check.
- Anyone who fronted ADE with `tailscale serve` and also set `ADE_TOKEN` now has to sign in with
  the token through the proxy.
- If ADE is killed with `SIGKILL`, the foreground `tailscale serve` keeps running, serving an
  error page, until it is stopped. A normal stop (Ctrl+C or `SIGTERM`) ends it.
