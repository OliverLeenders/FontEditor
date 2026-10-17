import fc from "fast-check";
import { expect } from "vitest";

/**
 * The rule every reader of a file from outside is held to: whatever bytes it
 * is handed, it gives an answer, or says why it cannot — an `Error` with words
 * in it — and does so within a time limit.
 *
 * What it must not do is fail by accident. A `TypeError` is a field read off
 * the end of something nobody checked was there; a `RangeError` an offset past
 * the end of a buffer, or a stack that ran out. Each is a fault in the reader,
 * however unlikely the file, and each is what a hostile file is made of.
 */
export function answersOrSaysWhy(read: () => unknown, within = TIME_LIMIT): void {
  const began = performance.now();
  try {
    read();
  } catch (error) {
    saysWhy(error);
  }
  expect(performance.now() - began, "how long it took, in milliseconds").toBeLessThan(within);
}

/** That what a reader threw is an `Error` with a reason, and not one it fell into. */
export function saysWhy(error: unknown): void {
  expect(error, "what was thrown").toBeInstanceOf(Error);
  const e = error as Error;
  expect(ACCIDENTS, `${e.name}: ${e.message}`).not.toContain(e.name);
  expect(e.message.trim(), "the reason given").not.toBe("");
}

/** What a reader throws only by accident. */
const ACCIDENTS = ["TypeError", "RangeError", "ReferenceError", "SyntaxError", "InternalError"];

/** How long a reader may take over one file. */
const TIME_LIMIT = 2000;

/**
 * How many files each property is tried with: a few hundred on a push, and as
 * many as `FUZZ_RUNS` says when somebody wants to look harder — every night.
 */
export const RUNS = Number(process.env["FUZZ_RUNS"] ?? 300);

/**
 * Where the random files start from: the same every time unless `FUZZ_SEED`
 * says otherwise, so a failure on a push is the same failure run again. The
 * night run gives a new one each time, and says it when anything fails.
 */
export const SEED = process.env["FUZZ_SEED"] === undefined ? 1 : Number(process.env["FUZZ_SEED"]);

/** The options every property here is checked with. */
export const CHECK = { numRuns: RUNS, seed: SEED } as const;

/**
 * A file that was good, spoiled: some of its bytes changed, a piece cut out or
 * repeated, or the end cut off. Most of a file has to be right to get a reader
 * past its first check, so most of what is tried should be nearly right.
 */
export function spoiled(goods: readonly Uint8Array[]): fc.Arbitrary<Uint8Array> {
  return fc
    .record({
      which: fc.nat({ max: goods.length - 1 }),
      changes: fc.array(
        fc.oneof(
          fc.record({ kind: fc.constant("set" as const), at: fc.nat(), to: fc.nat({ max: 255 }) }),
          fc.record({
            kind: fc.constant("cut" as const),
            at: fc.nat(),
            length: fc.nat({ max: 64 }),
          }),
          fc.record({
            kind: fc.constant("again" as const),
            at: fc.nat(),
            length: fc.nat({ max: 64 }),
          }),
          fc.record({ kind: fc.constant("end" as const), at: fc.nat() }),
          fc.record({
            kind: fc.constant("big" as const),
            at: fc.nat(),
            to: fc.constantFrom(0x00, 0x7f, 0x80, 0xff),
            width: fc.constantFrom(1, 2, 4),
          }),
        ),
        { minLength: 1, maxLength: 8 },
      ),
    })
    .map(({ which, changes }) => {
      let bytes = Uint8Array.from(goods[which]!);
      for (const change of changes) {
        if (bytes.length === 0) break;
        const at = change.at % bytes.length;
        if (change.kind === "set") {
          bytes[at] = change.to;
        } else if (change.kind === "big") {
          // A count or an offset turned into the largest or least it can be.
          for (let k = 0; k < change.width && at + k < bytes.length; k++) bytes[at + k] = change.to;
        } else if (change.kind === "cut") {
          bytes = Uint8Array.from([
            ...bytes.subarray(0, at),
            ...bytes.subarray(at + change.length),
          ]);
        } else if (change.kind === "again") {
          const piece = bytes.subarray(at, at + change.length);
          bytes = Uint8Array.from([...bytes.subarray(0, at), ...piece, ...bytes.subarray(at)]);
        } else {
          bytes = bytes.subarray(0, at);
        }
      }
      return bytes;
    });
}

/** Any bytes at all, of any length up to a few thousand. */
export const anyBytes: fc.Arbitrary<Uint8Array> = fc.uint8Array({ maxLength: 4096 });
