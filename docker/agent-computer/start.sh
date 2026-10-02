#!/bin/bash
# Boot the agent computer: virtual display, window manager, VNC + noVNC for the
# human view, the control API for the agent, and a browser on a blank page.
# Exits (and the container stops) as soon as a core service dies.
set -euo pipefail

: "${VNC_PASSWORD:?VNC_PASSWORD is required}"
: "${CONTROL_TOKEN:?CONTROL_TOKEN is required}"

Xvfb "$DISPLAY" -screen 0 "${SCREEN_WIDTH}x${SCREEN_HEIGHT}x24" -nolisten tcp &
XVFB=$!
for _ in $(seq 1 50); do
  xdpyinfo -display "$DISPLAY" >/dev/null 2>&1 && break
  sleep 0.1
done

# No toolbar, plain solid background: the browser window fills the whole
# screen the agent sees, with no busy wallpaper behind it. fbsetroot runs
# after fluxbox has applied its style, so the solid color wins.
mkdir -p "$HOME/.fluxbox"
echo "session.screen0.toolbar.visible: false" > "$HOME/.fluxbox/init"
fluxbox >/dev/null 2>&1 &
FB=$!
# Fluxbox paints its style background during startup; wait it out, then paint.
sleep 1
fbsetroot -solid "#22272e" -display "$DISPLAY" >/dev/null 2>&1 || true

mkdir -p "$HOME/.vnc"
x11vnc -storepasswd "$VNC_PASSWORD" "$HOME/.vnc/passwd" >/dev/null 2>&1
# -localhost: only websockify (same container) may reach raw VNC.
x11vnc -display "$DISPLAY" -rfbauth "$HOME/.vnc/passwd" -rfbport 5900 -localhost \
  -forever -shared -xrandr -noxdamage -quiet >/dev/null 2>&1 &
VNC=$!
websockify --web /opt/bin/noVNC 6080 localhost:5900 >/dev/null 2>&1 &
WS=$!

python3 /opt/ade/computer-server.py &
CTRL=$!

# The container is the sandbox, so Chromium's own sandbox is disabled
# (--test-type hides the warning bar that would otherwise eat screen space).
chromium --no-sandbox --test-type --no-first-run --no-default-browser-check \
  --disable-dev-shm-usage --disable-features=Translate --password-store=basic \
  --user-data-dir="$HOME/.chromium" --window-position=0,0 \
  --window-size="${SCREEN_WIDTH},${SCREEN_HEIGHT}" about:blank >/dev/null 2>&1 &

# The browser may be closed and reopened freely; only core services count.
wait -n "$XVFB" "$VNC" "$WS" "$CTRL"
