import type { Plugin } from "vite";
export function adeLocalApi(): Plugin;
export function handleLocalApi(request: Request): Promise<Response | undefined>;
