export const NO_RECOGNITION: string;
export const NOT_SECURE: string;
export const MIC_FALLBACK_NOTICE: string;

export type DictationSupport = { ok: true; canPickMic: boolean } | { ok: false; reason: string };

export function dictationSupport(env: {
  hasRecognition: boolean;
  isSecureContext: boolean;
  hasMediaDevices: boolean;
}): DictationSupport;

export function errorMessage(code: string | undefined | null): string | null;

export function composeDictation(input: {
  before: string;
  after: string;
  finals: readonly string[];
  interim?: string;
}): { text: string; caret: number };

export type MicOption = { id: string; label: string };

export function listMics(
  devices: readonly { kind: string; deviceId: string; label: string }[] | null | undefined,
): { mics: MicOption[]; labelsHidden: boolean };

export function resolveMic(
  mics: readonly MicOption[],
  savedId: string,
  verified?: boolean,
): { deviceId: string; missing: boolean };

export function micRoutingSupported(
  brands: readonly { brand: string; version: string }[] | null | undefined,
  mobile?: boolean,
): boolean;
