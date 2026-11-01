import { createStart } from "@tanstack/react-start";

// A single-page app (see vite.config.ts): no route renders on the server; the
// build only prerenders the shell. Defining this file also opts out of Start's
// default CSRF middleware, which only guards server functions, and ADE has none.
export const startInstance = createStart(() => ({ defaultSsr: false }));
