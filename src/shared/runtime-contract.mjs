import { readFileSync } from "node:fs";

const manifestUrl = new URL("../../package.json", import.meta.url);
const manifest = JSON.parse(readFileSync(manifestUrl, "utf8"));
const nodeEngine = manifest.engines?.node;
const nodeFloor = /^>=\s*(\d+)(?:\.\d+\.\d+)?$/.exec(nodeEngine ?? "");

if (!nodeFloor) throw new Error(`Unsupported Node engine declaration: ${nodeEngine}`);

export const MIN_NODE_MAJOR = Number(nodeFloor[1]);
export const DEFAULT_PORT = 3100;
