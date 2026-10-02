# ADE agent computer: an isolated Linux desktop a coding agent drives through
# ADE's computer tools (screenshot / mouse / keyboard / browser), streamed to
# the ADE UI over noVNC. Built locally by ADE on first use; never pushed.
#
# Based on Selenium's maintained Chromium image, which already ships Chromium,
# Xvfb, fluxbox, x11vnc, and noVNC. Pulling it from Docker Hub takes about a
# minute; installing the same stack with apt pulls ~290 MB from Debian's CDN,
# which is very slow on some networks. There is deliberately no RUN step: the
# control server needs only Python and the X11 libraries already present.
# Pinned by digest for reproducible builds (Chromium 152, 2026-09).
FROM selenium/standalone-chromium@sha256:08fd293648e126275782c616a61f4ee1d90cf413b1972ebc35dbd054d6789f55

ENV DISPLAY=:99 \
    SCREEN_WIDTH=1280 \
    SCREEN_HEIGHT=800

COPY --chmod=0755 start.sh computer-server.py /opt/ade/

# 6080: noVNC (human view), 7000: control API (agent tools). ADE publishes
# both on 127.0.0.1 only. Replaces Selenium's own entrypoint (no Grid/Java).
EXPOSE 6080 7000
ENTRYPOINT ["/opt/ade/start.sh"]
