// Adapted from T3 Code (https://github.com/pingdotgg/t3code): see the matching .mjs file for the source paths.
// Copyright (c) 2026 T3 Tools Inc. MIT License; see THIRD_PARTY_NOTICES.md.
export const MODIFIER_ALT: 1;
export const MODIFIER_CTRL: 2;
export const MODIFIER_META: 4;
export const MODIFIER_SHIFT: 8;
export const WHEEL_LINE_PX: number;

export type PreviewMouseButton = "none" | "left" | "middle" | "right";

export interface PagePoint {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
}

export interface KeyEventFields {
  readonly key: string;
  readonly code: string;
  readonly keyCode: number;
  readonly isComposing?: boolean;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}

export interface WheelDeltaFields {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly deltaMode: number;
}

export interface KeyClientMessage {
  readonly type: "key";
  readonly action: "down" | "up";
  readonly key: string;
  readonly code: string;
  readonly keyCode: number;
  readonly text?: string;
  readonly modifiers: number;
}

export interface WheelClientMessage {
  readonly type: "wheel";
  readonly x: number;
  readonly y: number;
  readonly deltaX: number;
  readonly deltaY: number;
  readonly modifiers: number;
}

export function modifierBits(event: {
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}): number;

export function buttonFromDomButton(button: number): PreviewMouseButton;

export function buttonBit(button: PreviewMouseButton): number;

export function pressedButton(buttons: number): PreviewMouseButton;

export function pagePointFromClient(
  point: { readonly clientX: number; readonly clientY: number; readonly clamp: boolean },
  rect: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  },
  frame: { readonly width: number; readonly height: number },
  viewport: { readonly width: number; readonly height: number },
): PagePoint | null;

export function wheelDeltaPx(
  event: WheelDeltaFields,
  viewportHeight: number,
): { readonly deltaX: number; readonly deltaY: number };

export function wheelMessage(
  point: { readonly x: number; readonly y: number },
  delta: { readonly deltaX: number; readonly deltaY: number },
  modifiers: number,
): WheelClientMessage;

export function keyMessage(action: "down" | "up", event: KeyEventFields): KeyClientMessage | null;
