#!/usr/bin/env python3
"""Read Chromium's libsecret entry on explicit import.

Adapted from T3 Code's native/browser-secret/main.c, copyright (c) 2026
T3 Tools Inc., MIT License; see THIRD_PARTY_NOTICES.md. Using ctypes lets a
single ADE npm package run on different Linux architectures without a build
toolchain. No secret is written to the command line, logs, or disk.
"""
import ctypes as c
import ctypes.util
import os
import sys


class Attribute(c.Structure):
    _fields_ = [("name", c.c_char_p), ("type", c.c_int)]


class Schema(c.Structure):
    _fields_ = [
        ("name", c.c_char_p), ("flags", c.c_int), ("attributes", Attribute * 32),
        ("reserved", c.c_int), *[("reserved%d" % i, c.c_void_p) for i in range(1, 8)],
    ]


class List(c.Structure):
    _fields_ = [("data", c.c_void_p), ("next", c.c_void_p), ("prev", c.c_void_p)]


def library(name):
    filename = ctypes.util.find_library(name)
    if not filename:
        raise OSError("required shared library unavailable")
    return c.CDLL(filename)


def bind(lib, name, result, args):
    function = getattr(lib, name)
    function.restype = result
    function.argtypes = args
    return function


def main():
    if len(sys.argv) != 2 or not sys.argv[1]:
        return 64
    secret, glib, gio, obj = map(library, ("secret-1", "glib-2.0", "gio-2.0", "gobject-2.0"))
    ptr = c.c_void_p
    schema = Schema()
    schema.name = b"chrome_libsecret_os_crypt_password_v2"
    schema.flags = 2  # SECRET_SCHEMA_DONT_MATCH_NAME
    schema.attributes[0] = Attribute(b"application", 0)
    build = bind(secret, "secret_attributes_build", ptr, [c.POINTER(Schema)])
    search = bind(secret, "secret_service_search_sync", ptr,
                  [ptr, c.POINTER(Schema), ptr, c.c_int, ptr, c.POINTER(ptr)])
    bind(glib, "g_set_application_name", None, [c.c_char_p])(b"ADE")
    unref_table = bind(glib, "g_hash_table_unref", None, [ptr])
    free_list = bind(glib, "g_list_free_full", None, [ptr, ptr])
    error_free = bind(glib, "g_error_free", None, [ptr])
    error_matches = bind(glib, "g_error_matches", c.c_int, [ptr, c.c_uint32, c.c_int])
    locked = bind(secret, "secret_item_get_locked", c.c_int, [ptr])
    get_secret = bind(secret, "secret_item_get_secret", ptr, [ptr])
    get_value = bind(secret, "secret_value_get", ptr, [ptr, c.POINTER(c.c_size_t)])
    release_value = bind(secret, "secret_value_unref", None, [ptr])
    # GLib's variadic function terminates attributes with NULL.
    attrs = build(c.byref(schema), c.c_char_p(b"application"),
                  c.c_char_p(os.fsencode(sys.argv[1])), ptr())
    if not attrs:
        return 4
    error = ptr()
    items = None
    try:
        items = search(None, c.byref(schema), attrs, 4 | 8, None, c.byref(error))
    finally:
        unref_table(attrs)
    try:
        if error:
            io_quark = bind(gio, "g_io_error_quark", c.c_uint32, [])()
            dbus_quark = bind(gio, "g_dbus_error_quark", c.c_uint32, [])()
            secret_quark = bind(secret, "secret_error_get_quark", c.c_uint32, [])()
            denied = (error_matches(error, io_quark, 14) or
                      error_matches(error, io_quark, 19) or
                      error_matches(error, dbus_quark, 9) or
                      error_matches(error, secret_quark, 2))
            error_free(error)
            return 3 if denied else 4
        if not items:
            return 2
        item = c.cast(items, c.POINTER(List)).contents.data
        if locked(item):
            return 3
        value = get_secret(item)
        if not value:
            return 4
        try:
            size = c.c_size_t()
            data = get_value(value, c.byref(size))
            if not data or size.value == 0:
                return 2
            if size.value > 65536:
                return 4
            sys.stdout.buffer.write(c.string_at(data, size.value))
            sys.stdout.buffer.flush()
            return 0
        finally:
            release_value(value)
    finally:
        if items:
            free_list(items, c.cast(obj.g_object_unref, ptr))


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, AttributeError, ValueError, BrokenPipeError):
        sys.exit(4)
