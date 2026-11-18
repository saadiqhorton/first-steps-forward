export type MediaKind = "image" | "video" | "audio";
export type MediaType = { kind: MediaKind; mime: string };
export const MEDIA_TYPES: Readonly<Record<string, MediaType>>;
export function mediaTypeOf(file: string): MediaType | null;
export function mediaKindOf(file: string): MediaKind | null;
