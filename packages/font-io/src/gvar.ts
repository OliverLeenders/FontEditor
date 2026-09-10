import type { Axis, Support } from "@fonteditor/font-model";

import { Bytes } from "./bytes.js";
import type { Drawn } from "./glyf.js";

/**
 * `gvar`: how a TrueType outline varies.
 *
 * The counterpart of the deltas CFF2 keeps inside its charstrings, and a
 * different shape for the same idea. `glyf` holds one outline — the default
 * master's — and this holds, for every glyph and every region of the
 * designspace, how far each of that outline's points moves when the region is
 * fully in effect. A rasteriser at some location works out how much each region
 * counts for, scales its deltas by that, and adds them up.
 *
 * Two things about it are worth knowing before reading the code.
 *
 * **The points are `glyf`'s points, exactly.** Not the drawing's — the drawing
 * is cubic and this is quadratic, and how many points a cubic becomes is a
 * decision made per glyph. So the same conversion has to feed both tables, and
 * it has to give every master the same points or there is nothing to subtract.
 * That is `compatiblePoints`, and it is the hard half of the whole feature.
 *
 * **There are four points more than the outline has.** The *phantom* points: a
 * horizontal origin and advance, and a vertical pair, appended to every glyph's
 * point list. They are not decoration — in this flavour they are *how* a
 * variable font varies its spacing. `HVAR` says the same thing in a table of
 * its own and is what a reader consults when it wants metrics without loading
 * outlines, but a reader that has the outlines in front of it takes the advance
 * from the second phantom point. Writing them as zeroes gives a font whose
 * letters change shape and keep the spacing of the master they were compiled
 * at — which is exactly the bug the CFF2 flavour needed `HVAR` to fix, arrived
 * at from the other direction.
 *
 * The first phantom point is the horizontal origin and does not move: it is the
 * left sidebearing measured from the outline, and both move together. The
 * vertical pair does not move either, there being no `vmtx` in a font from
 * here.
 */

/** Every master's points for one glyph, in the order the regions are in. */
export type GlyphVariation = {
  /** The default master's outline, which is what `glyf` holds. */
  readonly base: Drawn;
  /** One per region, in region order, each the outline at that region's peak. */
  readonly at: readonly Drawn[];
  /** The default master's advance, and the same at each region's peak. */
  readonly advance: number;
  readonly advanceAt: readonly number[];
};

/** Deltas smaller than this are not worth a byte; the format's own threshold. */
const NOTHING = 0.5;

export function gvarTable(
  axes: readonly Axis[],
  regions: readonly Support[],
  glyphs: readonly (GlyphVariation | null)[],
): Uint8Array {
  const out = new Bytes();

  out.u16(1); // majorVersion
  out.u16(0); // minorVersion
  out.u16(axes.length);
  // No shared tuples: every tuple carries its own peak. They are shared to save
  // bytes where many glyphs vary over the same regions, and the saving is two
  // bytes a glyph against a table of regions — worth having in a shipping
  // compiler, not worth the second indirection here.
  out.u16(0);
  const sharedAt = out.length;
  out.u32(0);
  out.u16(glyphs.length);
  // Offsets as 32-bit. The 16-bit form stores them halved, so every glyph's
  // data has to start on an even byte — a rule to keep rather than a saving.
  // Two bytes, not four: the field is a uint16, and writing it wide moves every
  // offset after it and leaves a reader finding no variations at all.
  out.u16(1);
  const arrayAt = out.length;
  out.u32(0);

  const offsetsAt = out.length;
  for (let i = 0; i <= glyphs.length; i++) out.u32(0);

  // Nothing is shared, so the shared-tuple array is empty and sits where the
  // data begins.
  out.patchU32(sharedAt, out.length);
  out.patchU32(arrayAt, out.length);
  const dataFrom = out.length;

  for (const [index, glyph] of glyphs.entries()) {
    out.patchU32(offsetsAt + index * 4, out.length - dataFrom);
    if (glyph === null) continue;

    const data = variationData(axes, regions, glyph);
    if (data !== null) out.bytes(data);
  }
  out.patchU32(offsetsAt + glyphs.length * 4, out.length - dataFrom);

  return out.done();
}

/**
 * One glyph's variations: a header per region, then the deltas.
 *
 * `null` where nothing about the glyph moves anywhere, which is ordinary — a
 * space, a glyph drawn identically in every master — and is said by giving it
 * no data at all rather than by writing an empty table for it.
 */
function variationData(
  axes: readonly Axis[],
  regions: readonly Support[],
  glyph: GlyphVariation,
): Uint8Array | null {
  const base = flat(glyph.base);
  const runs: { readonly region: Support; readonly deltas: readonly [number, number][] }[] = [];

  for (const [i, region] of regions.entries()) {
    const there = glyph.at[i];
    if (there === undefined) continue;

    const moved = flat(there);
    // A master the conversion could not match point for point. Nothing honest
    // can be said about it, and saying nothing leaves the glyph at its default
    // shape rather than at a wrong one.
    if (moved.length !== base.length) return null;

    const deltas = base.map((p, k) => [moved[k]!.x - p.x, moved[k]!.y - p.y] as [number, number]);

    // The four phantom points. The second is the horizontal advance, and how
    // far it moves is how much wider this master's letter is — which is the
    // whole of how spacing varies in this flavour. The other three do not move:
    // the origin travels with the outline, and there is no vertical metric
    // here to vary.
    const advance = (glyph.advanceAt[i] ?? glyph.advance) - glyph.advance;
    deltas.push([0, 0], [advance, 0], [0, 0], [0, 0]);

    if (deltas.some(([x, y]) => Math.abs(x) >= NOTHING || Math.abs(y) >= NOTHING)) {
      runs.push({ region, deltas });
    }
  }

  if (runs.length === 0) return null;

  const out = new Bytes();
  // The high bit says the point numbers are shared by every tuple, and what is
  // shared is written once at the front of the data.
  out.u16(0x8000 | runs.length);
  const dataAt = out.length;
  out.u16(0);

  const bodies = runs.map((run) => packedDeltas(run.deltas));
  // A single zero byte: the packed-point-number form whose count is nought,
  // which means every point in the glyph rather than none of them.
  const shared = Uint8Array.of(0);

  for (const [i, run] of runs.entries()) {
    out.u16(bodies[i]!.length);
    // The peak is written here rather than referred to, and the region is
    // written out in full whenever it is not a plain peak — an axis whose
    // start and end are not implied by the peak has to say so.
    out.u16(0x8000 | (intermediate(axes, run.region) ? 0x4000 : 0));
    for (const a of axes) out.f2dot14(run.region[a.tag]?.peak ?? 0);
    if (intermediate(axes, run.region)) {
      for (const a of axes) out.f2dot14(run.region[a.tag]?.min ?? 0);
      for (const a of axes) out.f2dot14(run.region[a.tag]?.max ?? 0);
    }
  }

  out.patchU16(dataAt, out.length);
  out.bytes(shared);
  for (const body of bodies) out.bytes(body);

  // Every glyph's data begins on a long boundary in the 32-bit offset form as
  // readily as in the 16-bit one; padding costs three bytes at most and keeps
  // the offsets we write true of what a reader finds.
  while (out.length % 4 !== 0) out.u8(0);

  return out.done();
}

/**
 * Whether a region needs its start and end written out.
 *
 * A tuple whose peak alone is given is read as spanning from zero to the peak
 * to zero, which is what a region between two masters on one axis looks like.
 * Anything else — a region that does not reach zero, or one bounded short of
 * the axis end — has to say so, and the interpolation model here produces those
 * as soon as there are three masters on an axis.
 */
function intermediate(axes: readonly Axis[], region: Support): boolean {
  return axes.some((a) => {
    const at = region[a.tag];
    if (at === undefined) return false;
    const implied = at.peak < 0 ? { min: -1, max: 0 } : { min: 0, max: 1 };
    if (at.peak === 0) return at.min !== 0 || at.max !== 0;
    return at.min !== implied.min || at.max !== implied.max;
  });
}

/** Every point of every contour, in the order the file writes them. */
function flat(drawn: Drawn): { x: number; y: number }[] {
  return drawn.contours.flat().map((p) => ({ x: Math.round(p.pt.x), y: Math.round(p.pt.y) }));
}

/**
 * The deltas, run-length encoded: all the x's, then all the y's.
 *
 * Three kinds of run, and the format spends a byte saying which and how many.
 * A run of zeroes costs that byte alone, which is why a glyph where only one
 * point moves is nearly free — and why the phantom points, which never move,
 * cost four bytes across the whole font rather than sixteen per glyph.
 */
function packedDeltas(deltas: readonly (readonly [number, number])[]): Uint8Array {
  const out = new Bytes();
  runsOf(
    deltas.map(([x]) => Math.round(x)),
    out,
  );
  runsOf(
    deltas.map(([, y]) => Math.round(y)),
    out,
  );
  return out.done();
}

function runsOf(values: readonly number[], out: Bytes): void {
  let at = 0;

  while (at < values.length) {
    const value = values[at]!;

    if (value === 0) {
      const run = spanOf(values, at, (v) => v === 0);
      out.u8(0x80 | (run - 1));
      at += run;
      continue;
    }

    const small = (v: number): boolean => v !== 0 && v >= -128 && v <= 127;
    if (small(value)) {
      const run = spanOf(values, at, small);
      out.u8(run - 1);
      for (let i = 0; i < run; i++) out.i8(values[at + i]!);
      at += run;
      continue;
    }

    const run = spanOf(values, at, (v) => !small(v) && v !== 0);
    out.u8(0x40 | (run - 1));
    for (let i = 0; i < run; i++) out.i16(values[at + i]!);
    at += run;
  }
}

/** How far a run of alike values goes, up to the 64 one control byte can say. */
function spanOf(values: readonly number[], from: number, alike: (v: number) => boolean): number {
  let n = 0;
  while (n < 64 && from + n < values.length && alike(values[from + n]!)) n += 1;
  return n;
}
