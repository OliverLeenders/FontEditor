import type { Axis, Location } from "@typewright/font-model";

import { Bytes } from "./bytes.js";

/**
 * `fvar`: what a variable font can be asked for.
 *
 * The axes, with their ranges, and the named instances a menu offers — Light,
 * Regular, Bold. Without this table a font with variations is a font nothing
 * knows how to vary: every other variation table describes *how* to move, and
 * this is the one that says what may be moved and how far.
 *
 * Names are not in here. An axis and an instance each carry a `nameID` into the
 * `name` table, so writing this means adding records there too — see
 * `withNames`.
 */

export type NamedInstance = {
  readonly name: string;
  readonly location: Location;
};

/** An axis or an instance, and the name id it was given. */
export type Named<T> = { readonly it: T; readonly nameId: number };

export function fvarTable(
  axes: readonly Named<Axis>[],
  instances: readonly Named<NamedInstance>[],
): Uint8Array {
  const out = new Bytes();
  const axisSize = 20;
  const instanceSize = 4 + axes.length * 4;

  out.u16(1).u16(0); // version 1.0
  out.u16(16); // where the axes start, from the beginning of the table
  out.u16(2); // a reserved field the format wants set to two
  out.u16(axes.length);
  out.u16(axisSize);
  out.u16(instances.length);
  out.u16(instanceSize);

  for (const { it, nameId } of axes) {
    out.ascii(tag(it.tag));
    out.fixed(it.min);
    out.fixed(it.default);
    out.fixed(it.max);
    // No flags. The one that exists hides an axis from a user interface, and an
    // axis this editor was told about is one somebody meant.
    out.u16(0);
    out.u16(nameId);
  }

  for (const { it, nameId } of instances) {
    out.u16(nameId);
    out.u16(0); // flags, of which there are none
    for (const { it: axis } of axes) out.fixed(it.location[axis.tag] ?? axis.default);
  }

  return out.done();
}

/** Four characters, padded or cut, because the format has room for exactly four. */
function tag(value: string): string {
  return `${value}    `.slice(0, 4);
}

/**
 * `STAT`: what the axes mean, for software choosing between fonts.
 *
 * Required of a variable font, and for a reason `fvar` does not cover: `fvar`
 * says a font can be varied, and this says how the results relate to the rest
 * of the family — which weight is the regular one, what a menu should call the
 * point at 700, whether this file and another are the same design.
 *
 * Written with the axes and no axis values. That is a legal and honest table:
 * the axes are declared and named, and nothing is claimed about what the values
 * along them should be called, because this editor has not been told. A font
 * that named its stops without being told would be inventing them.
 */
export function statTable(axes: readonly Named<Axis>[]): Uint8Array {
  const out = new Bytes();
  const axisSize = 8;

  out.u16(1).u16(1); // version 1.1, which is the one with a fallback name
  out.u16(axisSize);
  out.u16(axes.length);
  out.u32(20); // where the axis records start: straight after this header
  out.u16(0); // no axis values
  out.u32(0); // and so no offsets to them
  // What to call a style whose every axis value has been elided. Name 2 is the
  // subfamily, which is what the font already calls itself.
  out.u16(2);

  for (const [i, { it, nameId }] of axes.entries()) {
    out.ascii(`${it.tag}    `.slice(0, 4));
    out.u16(nameId);
    out.u16(i); // the order they should be shown in
  }

  return out.done();
}
