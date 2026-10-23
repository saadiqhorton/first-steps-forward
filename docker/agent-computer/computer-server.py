#!/usr/bin/env python3
"""Control API for the ADE agent computer.

Runs inside the container on :7000 (published by ADE on 127.0.0.1 only) and
turns ADE's computer-use actions into X11 input. Everything is Python stdlib
plus the X11/XTest libraries the base image already has (via ctypes): no
xdotool, ImageMagick, or socat to install. Every request must carry the
per-container token in `X-ADE-Token`. Each action replies with a fresh PNG
screenshot (base64) so the agent always sees the result.
"""
import base64
import ctypes
import hmac
import json
import os
import queue
import socket
import struct
import subprocess
import threading
import time
import zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

TOKEN = os.environ["CONTROL_TOKEN"]
WIDTH = int(os.environ.get("SCREEN_WIDTH", "1280"))
HEIGHT = int(os.environ.get("SCREEN_HEIGHT", "800"))
HOST_ALIAS = "host.docker.internal"
# Chromium's DevTools endpoint binds 127.0.0.1 inside the container, so ADE's
# published port cannot reach it directly. Bridge 0.0.0.0:9223 to it instead.
CDP_PORT = 9222
CDP_BRIDGE_PORT = 9223
BUTTONS = {"left": 1, "middle": 2, "right": 3}
SCROLL = {"up": 4, "down": 5, "left": 6, "right": 7}
KEY_ALIASES = {
    "ctrl": "Control_L", "control": "Control_L", "shift": "Shift_L", "alt": "Alt_L",
    "meta": "Super_L", "super": "Super_L", "cmd": "Super_L", "win": "Super_L",
    "enter": "Return", "return": "Return", "esc": "Escape", "escape": "Escape",
    "backspace": "BackSpace", "delete": "Delete", "del": "Delete", "tab": "Tab",
    "space": "space", "up": "Up", "down": "Down", "left": "Left", "right": "Right",
    "pageup": "Prior", "pagedown": "Next", "home": "Home", "end": "End",
}
CHROMIUM = [
    "chromium", "--no-sandbox", "--test-type", "--no-first-run", "--no-default-browser-check",
    "--disable-dev-shm-usage", "--disable-features=Translate", "--password-store=basic",
    f"--remote-debugging-port={CDP_PORT}",
    f"--user-data-dir={os.path.expanduser('~/.chromium')}", "--window-position=0,0",
    f"--window-size={WIDTH},{HEIGHT}",
]


class ActionError(Exception):
    pass


# ---- X11 via ctypes ---------------------------------------------------------
c_ulong, c_int, c_uint, c_void_p = ctypes.c_ulong, ctypes.c_int, ctypes.c_uint, ctypes.c_void_p
x11 = ctypes.cdll.LoadLibrary("libX11.so.6")
xtst = ctypes.cdll.LoadLibrary("libXtst.so.6")


class XImage(ctypes.Structure):
    _fields_ = [
        ("width", c_int), ("height", c_int), ("xoffset", c_int), ("format", c_int),
        ("data", ctypes.POINTER(ctypes.c_char)), ("byte_order", c_int),
        ("bitmap_unit", c_int), ("bitmap_bit_order", c_int), ("bitmap_pad", c_int),
        ("depth", c_int), ("bytes_per_line", c_int), ("bits_per_pixel", c_int),
        ("red_mask", c_ulong), ("green_mask", c_ulong), ("blue_mask", c_ulong),
    ]


def _sig(lib, name, restype, *argtypes):
    fn = getattr(lib, name)
    fn.restype, fn.argtypes = restype, list(argtypes)
    return fn


XOpenDisplay = _sig(x11, "XOpenDisplay", c_void_p, ctypes.c_char_p)
XDefaultRootWindow = _sig(x11, "XDefaultRootWindow", c_ulong, c_void_p)
XStringToKeysym = _sig(x11, "XStringToKeysym", c_ulong, ctypes.c_char_p)
XKeysymToKeycode = _sig(x11, "XKeysymToKeycode", ctypes.c_ubyte, c_void_p, c_ulong)
XkbKeycodeToKeysym = _sig(x11, "XkbKeycodeToKeysym", c_ulong, c_void_p, ctypes.c_ubyte, c_int, c_int)
XDisplayKeycodes = _sig(x11, "XDisplayKeycodes", c_int, c_void_p, ctypes.POINTER(c_int), ctypes.POINTER(c_int))
XGetKeyboardMapping = _sig(
    x11, "XGetKeyboardMapping", ctypes.POINTER(c_ulong), c_void_p, ctypes.c_ubyte, c_int, ctypes.POINTER(c_int)
)
XChangeKeyboardMapping = _sig(
    x11, "XChangeKeyboardMapping", c_int, c_void_p, c_int, c_int, ctypes.POINTER(c_ulong), c_int
)
XGetImage = _sig(x11, "XGetImage", ctypes.POINTER(XImage), c_void_p, c_ulong, c_int, c_int, c_uint, c_uint, c_ulong, c_int)
XDestroyImage = _sig(x11, "XDestroyImage", c_int, ctypes.POINTER(XImage))
XQueryPointer = _sig(
    x11, "XQueryPointer", c_int, c_void_p, c_ulong,
    ctypes.POINTER(c_ulong), ctypes.POINTER(c_ulong),
    ctypes.POINTER(c_int), ctypes.POINTER(c_int), ctypes.POINTER(c_int), ctypes.POINTER(c_int),
    ctypes.POINTER(c_uint),
)
XFree = _sig(x11, "XFree", c_int, c_void_p)
XSync = _sig(x11, "XSync", c_int, c_void_p, c_int)
XTestFakeMotionEvent = _sig(xtst, "XTestFakeMotionEvent", c_int, c_void_p, c_int, c_int, c_int, c_ulong)
XTestFakeButtonEvent = _sig(xtst, "XTestFakeButtonEvent", c_int, c_void_p, c_uint, c_int, c_ulong)
XTestFakeKeyEvent = _sig(xtst, "XTestFakeKeyEvent", c_int, c_void_p, c_uint, c_int, c_ulong)

ZPIXMAP = 2
ALL_PLANES = c_ulong(-1).value
X_LOCK = threading.Lock()  # one Display connection, used from many request threads


def open_display():
    name = os.environ.get("DISPLAY", ":99").encode()
    for _ in range(100):
        dpy = XOpenDisplay(name)
        if dpy:
            return dpy
        time.sleep(0.1)
    raise SystemExit("could not open the X display")


DPY = open_display()
ROOT = XDefaultRootWindow(DPY)
_spare_keycode = None


def spare_keycode():
    """A keycode with no keysyms, borrowed to type characters the keymap lacks."""
    global _spare_keycode
    if _spare_keycode is None:
        low, high = c_int(), c_int()
        XDisplayKeycodes(DPY, ctypes.byref(low), ctypes.byref(high))
        per = c_int()
        count = high.value - low.value + 1
        syms = XGetKeyboardMapping(DPY, low.value, count, ctypes.byref(per))
        try:
            for i in range(count - 1, -1, -1):
                if all(syms[i * per.value + j] == 0 for j in range(per.value)):
                    _spare_keycode = low.value + i
                    break
        finally:
            XFree(syms)
        if _spare_keycode is None:
            raise ActionError("no free keycode available to type that character")
    return _spare_keycode


def key_tap(keycode, shift=False):
    shift_code = XKeysymToKeycode(DPY, XStringToKeysym(b"Shift_L"))
    if shift:
        XTestFakeKeyEvent(DPY, shift_code, 1, 0)
    XTestFakeKeyEvent(DPY, keycode, 1, 0)
    XTestFakeKeyEvent(DPY, keycode, 0, 0)
    if shift:
        XTestFakeKeyEvent(DPY, shift_code, 0, 0)
    XSync(DPY, 0)


def type_char(char):
    if char == "\n":
        return key_tap(XKeysymToKeycode(DPY, XStringToKeysym(b"Return")))
    if char == "\t":
        return key_tap(XKeysymToKeycode(DPY, XStringToKeysym(b"Tab")))
    code = ord(char)
    keysym = code if 0x20 <= code <= 0x7E or 0xA0 <= code <= 0xFF else 0x01000000 | code
    keycode = XKeysymToKeycode(DPY, keysym)
    if keycode:
        if XkbKeycodeToKeysym(DPY, keycode, 0, 0) == keysym:
            return key_tap(keycode)
        if XkbKeycodeToKeysym(DPY, keycode, 0, 1) == keysym:
            return key_tap(keycode, shift=True)
    # Not on the keymap (or only on an odd level): bind it to a spare keycode.
    spare = spare_keycode()
    syms = (c_ulong * 2)(keysym, keysym)
    XChangeKeyboardMapping(DPY, spare, 2, syms, 1)
    XSync(DPY, 0)
    time.sleep(0.03)  # let clients see the MappingNotify before the key arrives
    key_tap(spare)


def keysym_for(name):
    keysym = XStringToKeysym(KEY_ALIASES.get(name.lower(), name).encode())
    if not keysym and len(name) == 1:
        keysym = ord(name)
    if not keysym:
        raise ActionError(f"unknown key: {name}")
    keycode = XKeysymToKeycode(DPY, keysym)
    if not keycode:
        raise ActionError(f"key not on the keyboard: {name}")
    return keycode


def press_combo(combo):
    codes = [keysym_for(part) for part in combo.split("+") if part]
    if not codes:
        raise ActionError(f"empty key combo: {combo!r}")
    for code in codes:
        XTestFakeKeyEvent(DPY, code, 1, 0)
    for code in reversed(codes):
        XTestFakeKeyEvent(DPY, code, 0, 0)
    XSync(DPY, 0)


def move(x, y):
    XTestFakeMotionEvent(DPY, -1, x, y, 0)
    XSync(DPY, 0)


def click(button, repeat=1):
    for i in range(repeat):
        XTestFakeButtonEvent(DPY, button, 1, 0)
        XTestFakeButtonEvent(DPY, button, 0, 0)
        XSync(DPY, 0)
        if i + 1 < repeat:
            time.sleep(0.08)


def cursor():
    root, child, rx, ry, wx, wy, mask = c_ulong(), c_ulong(), c_int(), c_int(), c_int(), c_int(), c_uint()
    XQueryPointer(DPY, ROOT, *(ctypes.byref(v) for v in (root, child, rx, ry, wx, wy, mask)))
    return {"x": rx.value, "y": ry.value}


def png(width, height, rgb):
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    stride = width * 3
    raw = b"".join(b"\x00" + rgb[y * stride:(y + 1) * stride] for y in range(height))
    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b"")


def screenshot():
    image = XGetImage(DPY, ROOT, 0, 0, WIDTH, HEIGHT, ALL_PLANES, ZPIXMAP)
    if not image:
        raise ActionError("screenshot failed: XGetImage returned nothing")
    try:
        img = image.contents
        if img.bits_per_pixel != 32 or img.byte_order != 0:
            raise ActionError(f"unsupported framebuffer format ({img.bits_per_pixel} bpp)")
        stride = img.bytes_per_line
        data = ctypes.string_at(img.data, stride * img.height)
        if stride != img.width * 4:
            data = b"".join(data[y * stride:y * stride + img.width * 4] for y in range(img.height))
        rgb = bytearray(img.width * img.height * 3)
        rgb[0::3], rgb[1::3], rgb[2::3] = data[2::4], data[1::4], data[0::4]  # BGRX -> RGB
        return base64.b64encode(png(img.width, img.height, bytes(rgb))).decode()
    finally:
        XDestroyImage(image)


# ---- localhost forwarding to the host's dev server --------------------------
forwards = {}
tunnel_waiters = {}


def port_open(host, port, timeout=1.5):
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def pump(src, dst):
    try:
        while True:
            data = src.recv(65536)
            if not data:
                break
            dst.sendall(data)
    except OSError:
        pass
    finally:
        try:
            dst.shutdown(socket.SHUT_WR)
        except OSError:
            pass


def bridge(client, port, host=HOST_ALIAS):
    try:
        upstream = socket.create_connection((host, port), timeout=10)
        upstream.settimeout(None)
    except OSError:
        client.close()
        return
    back = threading.Thread(target=pump, args=(upstream, client), daemon=True)
    back.start()
    pump(client, upstream)
    back.join()
    client.close()
    upstream.close()


def ensure_forward(port, host_reachable=False):
    """Make localhost:PORT inside the computer reach the host's localhost:PORT.

    The browser keeps a `localhost` Host header, so dev servers with host
    checks (Vite allowedHosts, Next) behave exactly as on the host.
    On Linux engines where the host dev server binds 127.0.0.1 (or a firewall
    blocks docker0 -> host), ADE supplies a reverse tunnel over :7000.
    """
    waiters = tunnel_waiters.setdefault(port, queue.Queue())
    if port in forwards or port_open("127.0.0.1", port, 0.3):
        return
    direct = port_open(HOST_ALIAS, port, 0.4)
    if not direct and not host_reachable:
        raise ActionError(
            f"Nothing is reachable on the host at port {port}. Start the project's dev server "
            "(dev_server_start) and use the URL it reports."
        )
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        listener.bind(("127.0.0.1", port))
    except OSError as error:
        listener.close()
        raise ActionError(f"Could not forward port {port} into the computer: {error}")
    listener.listen(64)
    forwards[port] = listener

    def handle_client(client):
        if port_open(HOST_ALIAS, port, 0.2):
            bridge(client, port, HOST_ALIAS)
        else:
            waiters.put(client)

    def accept_loop():
        while True:
            client, _ = listener.accept()
            threading.Thread(target=handle_client, args=(client,), daemon=True).start()

    threading.Thread(target=accept_loop, daemon=True).start()


def serve_cdp_bridge(listener):
    """Accept loop for Chromium's DevTools port. Each client connects upstream on
    its own, so it tolerates Chromium not listening yet (or having exited)."""
    while True:
        client, _ = listener.accept()
        threading.Thread(target=bridge, args=(client, CDP_PORT, "127.0.0.1"), daemon=True).start()


def start_cdp_bridge():
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listener.bind(("0.0.0.0", CDP_BRIDGE_PORT))
    listener.listen(64)
    threading.Thread(target=serve_cdp_bridge, args=(listener,), daemon=True).start()


def open_url(url, host_reachable=False):
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ActionError("only http(s) URLs can be opened")
    if parsed.hostname in ("localhost", "127.0.0.1", "0.0.0.0"):
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        ensure_forward(port, host_reachable=host_reachable)
        if parsed.hostname != "localhost":
            url = parsed._replace(netloc=f"localhost:{port}").geturl()
    # A second launch with the same profile opens a tab in the running browser
    # (or relaunches it if the user closed it) and raises the window.
    subprocess.Popen([*CHROMIUM, url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


# ---- actions ----------------------------------------------------------------
def coord(body, key_x="x", key_y="y"):
    try:
        x, y = int(body[key_x]), int(body[key_y])
    except (KeyError, TypeError, ValueError):
        raise ActionError(f"{key_x}/{key_y} must be integers")
    if not (0 <= x < WIDTH and 0 <= y < HEIGHT):
        raise ActionError(f"({x}, {y}) is outside the {WIDTH}x{HEIGHT} screen")
    return x, y


def perform(body):
    action = body.get("action")
    if action == "screenshot":
        pass
    elif action in ("click", "double_click", "right_click", "middle_click"):
        x, y = coord(body)
        button = {"right_click": "right", "middle_click": "middle"}.get(action, body.get("button", "left"))
        if button not in BUTTONS:
            raise ActionError("button must be left, middle, or right")
        move(x, y)
        click(BUTTONS[button], 2 if action == "double_click" else 1)
    elif action == "move":
        move(*coord(body))
    elif action == "drag":
        (x1, y1), (x2, y2) = coord(body), coord(body, "to_x", "to_y")
        move(x1, y1)
        XTestFakeButtonEvent(DPY, 1, 1, 0)
        for step in range(1, 11):  # intermediate motion so apps see a real drag
            move(x1 + (x2 - x1) * step // 10, y1 + (y2 - y1) * step // 10)
            time.sleep(0.015)
        XTestFakeButtonEvent(DPY, 1, 0, 0)
        XSync(DPY, 0)
    elif action == "type":
        text = body.get("text")
        if not isinstance(text, str) or not text:
            raise ActionError("text is required")
        for char in text:
            type_char(char)
            time.sleep(0.008)
    elif action == "key":
        keys = body.get("keys")
        if isinstance(keys, str):
            keys = keys.split()
        if not keys or not all(isinstance(k, str) and k for k in keys):
            raise ActionError('keys is required, e.g. "ctrl+l" or ["Return"]')
        for combo in keys:
            press_combo(combo)
            time.sleep(0.04)
    elif action == "scroll":
        direction = body.get("direction", "down")
        if direction not in SCROLL:
            raise ActionError("direction must be up, down, left, or right")
        amount = max(1, min(int(body.get("amount", 3)), 20))
        if "x" in body or "y" in body:
            move(*coord(body))
        for _ in range(amount):
            click(SCROLL[direction])
            time.sleep(0.03)
    elif action == "open_url":
        open_url(str(body.get("url", "")), host_reachable=bool(body.get("host_reachable")))
        time.sleep(1.5)
    elif action == "wait":
        time.sleep(max(0.0, min(float(body.get("seconds", 1)), 10.0)))
    elif action == "forward":
        # Opens localhost:PORT inside the computer to the host's dev server. Only
        # ADE calls this (before the browser navigates); no screenshot is taken.
        try:
            port = int(body.get("port"))
        except (TypeError, ValueError):
            raise ActionError("port must be an integer")
        if not 1 <= port <= 65535:
            raise ActionError("port must be between 1 and 65535")
        ensure_forward(port, host_reachable=bool(body.get("host_reachable")))
        return {"ok": True}
    else:
        raise ActionError(f"unknown action: {action}")
    if action not in ("screenshot", "wait", "open_url"):
        time.sleep(0.35)  # let the UI react before capturing
    return {
        "ok": True,
        "screenshot": screenshot(),
        "mimeType": "image/png",
        "cursor": cursor(),
        "width": WIDTH,
        "height": HEIGHT,
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "ade-computer/1"

    def log_message(self, *_):
        pass

    def reply(self, status, payload):
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def authorized(self):
        return hmac.compare_digest(self.headers.get("x-ade-token", ""), TOKEN)

    def do_GET(self):
        if not self.authorized():
            return self.reply(401, {"error": "unauthorized"})
        if self.path == "/health":
            return self.reply(200, {"ok": True, "width": WIDTH, "height": HEIGHT})
        return self.reply(404, {"error": "not found"})

    def do_POST(self):
        if not self.authorized():
            return self.reply(401, {"error": "unauthorized"})
        if self.path.startswith("/tunnel/"):
            self.close_connection = True
            try:
                port = int(self.path.split("/")[2])
            except (IndexError, ValueError):
                return self.reply(400, {"error": "invalid port"})
            waiters = tunnel_waiters.setdefault(port, queue.Queue())
            try:
                client = waiters.get(timeout=25)
            except queue.Empty:
                return self.reply(204, {})
            try:
                self.connection.sendall(b"HTTP/1.1 200 OK\r\n\r\n")
            except OSError:
                waiters.put(client)
                return
            back = threading.Thread(target=pump, args=(self.connection, client), daemon=True)
            back.start()
            pump(client, self.connection)
            back.join()
            client.close()
            return
        if self.path != "/action":
            return self.reply(404, {"error": "not found"})
        try:
            length = min(int(self.headers.get("content-length", "0")), 256 * 1024)
            body = json.loads(self.rfile.read(length) or b"{}")
            with X_LOCK:  # Xlib calls on one connection must not interleave
                result = perform(body)
            return self.reply(200, result)
        except ActionError as error:
            return self.reply(400, {"error": str(error)})
        except Exception as error:  # report, never crash the server
            return self.reply(500, {"error": f"{type(error).__name__}: {error}"})


if __name__ == "__main__":
    try:
        start_cdp_bridge()
    except OSError as error:  # the computer tools still work without the browser bridge
        print(f"CDP bridge not started: {error}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", 7000), Handler).serve_forever()
