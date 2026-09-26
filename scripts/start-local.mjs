// Local ADE is intentionally loopback-only. Override PORT for a different local port.
process.env.HOST = "127.0.0.1";
process.env.NITRO_HOST = "127.0.0.1";
process.env.NITRO_PORT ??= process.env.PORT ?? "3000";
await import("../.output/server/index.mjs");
