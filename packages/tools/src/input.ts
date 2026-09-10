import type { Vec2 } from "@typewright/geometry";

/**
 * Input as the tools want it, not as the browser produces it.
 *
 * The host converts a `PointerEvent` into one of these: screen coordinates
 * become design units, and the platform's modifier soup becomes four booleans.
 * That keeps the tools free of DOM types and lets a test drive a whole gesture
 * from plain objects.
 */
export type Modifiers = {
  readonly shift: boolean;
  readonly alt: boolean;
  readonly ctrl: boolean;
  readonly meta: boolean;
};

export const NO_MODIFIERS: Modifiers = {
  shift: false,
  alt: false,
  ctrl: false,
  meta: false,
};

export function modifiers(partial: Partial<Modifiers> = {}): Modifiers {
  return { ...NO_MODIFIERS, ...partial };
}

export type PointerInput = {
  /** Position in design units. */
  readonly point: Vec2;
  readonly modifiers: Modifiers;
};

export type KeyInput = {
  /** The key value, as `KeyboardEvent.key` reports it: "Escape", "ArrowLeft". */
  readonly key: string;
  readonly modifiers: Modifiers;
};

export function pointerInput(point: Vec2, mods: Partial<Modifiers> = {}): PointerInput {
  return { point, modifiers: modifiers(mods) };
}

export function keyInput(key: string, mods: Partial<Modifiers> = {}): KeyInput {
  return { key, modifiers: modifiers(mods) };
}
