/**
 * StuffIt method 15, which Aladdin called Arsenic: the "best compression" of
 * StuffIt 5, and what nearly every archive from that era uses.
 *
 * It is bzip2's shape with a different coder. The data is cut into blocks; each
 * block is run through a Burrows-Wheeler transform, which sorts every rotation
 * of the block and keeps the last column, so that bytes with similar
 * neighbourhoods end up beside each other; that column goes through move-to-
 * front, which turns those runs into runs of zero; the zeroes are counted
 * rather than written; and the whole lot is coded by an adaptive arithmetic
 * coder whose models learn as they go. Undoing it means running that backwards,
 * and none of the steps can be skipped or reordered.
 *
 * There is a further run-length layer *inside* the block, applied before the
 * transform and undone after it: four equal bytes are followed by a count of
 * how many more of them there are. So the decoder reads the transform's output
 * through a little state machine rather than copying it out. And a block may be
 * marked "randomized", an old workaround for input that made the sorter slow,
 * which flips the low bit of certain bytes at intervals taken from a fixed
 * table.
 *
 * Ported from the description in XADMaster's `XADStuffItArsenicHandle.m` and
 * `BWT.c` — see THIRD_PARTY_NOTICES.
 */

import { HighBits } from "./bits.js";

/**
 * The arithmetic coder's working width, in bits.
 *
 * 26 rather than 32 because the decoder multiplies a frequency by the range,
 * and that product has to stay exact. In C this was a choice about int
 * overflow; here it is what keeps every intermediate inside the 53 bits a
 * double can hold without rounding, which is the same requirement wearing
 * different clothes.
 */
const NUM_BITS = 26;
const ONE = 1 << (NUM_BITS - 1);
const HALF = 1 << (NUM_BITS - 2);

/**
 * An adaptive frequency model: which symbols can come next, and how likely each
 * has been so far.
 *
 * Every symbol starts equally likely and each one seen gains `increment`. When
 * the total passes `limit` every frequency is halved, which is the model
 * forgetting: recent bytes are allowed to matter more than the start of the
 * file. Halving keeps a minimum of one so a symbol never becomes impossible to
 * code.
 */
type Model = {
  readonly increment: number;
  readonly limit: number;
  readonly count: number;
  readonly symbol: Int32Array;
  readonly frequency: Int32Array;
  total: number;
};

function model(first: number, last: number, increment: number, limit: number): Model {
  const count = last - first + 1;
  const m: Model = {
    increment,
    limit,
    count,
    symbol: new Int32Array(count),
    frequency: new Int32Array(count),
    total: 0,
  };
  for (let i = 0; i < count; i++) m.symbol[i] = i + first;
  resetModel(m);
  return m;
}

function resetModel(m: Model): void {
  m.total = m.increment * m.count;
  m.frequency.fill(m.increment);
}

function learn(m: Model, index: number): void {
  m.frequency[index] = m.frequency[index]! + m.increment;
  m.total += m.increment;
  if (m.total <= m.limit) return;

  m.total = 0;
  for (let i = 0; i < m.count; i++) {
    const halved = (m.frequency[i]! + 1) >> 1;
    m.frequency[i] = halved;
    m.total += halved;
  }
}

type Decoder = {
  readonly bits: HighBits;
  range: number;
  code: number;
};

function narrow(d: Decoder, low: number, size: number, total: number): void {
  const factor = Math.floor(d.range / total);
  const lowered = factor * low;
  d.code -= lowered;
  // The top symbol takes whatever the division left over, so that the ranges
  // add up to exactly what the encoder had. Dropping those few units would
  // desynchronise the two sides a few thousand symbols later.
  if (low + size === total) d.range -= lowered;
  else d.range = size * factor;

  while (d.range <= HALF) {
    d.range *= 2;
    d.code = d.code * 2 + d.bits.next();
  }
}

function symbolOf(d: Decoder, m: Model): number {
  const scaled = Math.floor(d.code / Math.floor(d.range / m.total));
  let cumulative = 0;
  let i = 0;
  for (; i < m.count - 1; i++) {
    const f = m.frequency[i]!;
    if (cumulative + f > scaled) break;
    cumulative += f;
  }
  narrow(d, cumulative, m.frequency[i]!, m.total);
  learn(m, i);
  return m.symbol[i]!;
}

/** `n` symbols from a two-symbol model, read as a number, low bit first. */
function numberOf(d: Decoder, m: Model, n: number): number {
  let value = 0;
  for (let i = 0; i < n; i++) if (symbolOf(d, m)) value |= 1 << i;
  return value >>> 0;
}

/**
 * The intervals at which a randomized block has a bit flipped.
 *
 * Stepped through cyclically and added up, so the positions it names are the
 * running sums rather than the numbers themselves. Nobody needs to know why
 * these numbers: they are a shared constant, and the encoder used the same
 * ones.
 */
// prettier-ignore
const RANDOM: readonly number[] = [
  0xee, 0x56, 0xf8, 0xc3, 0x9d, 0x9f, 0xae, 0x2c, 0xad, 0xcd, 0x24, 0x9d, 0xa6, 0x101, 0x18, 0xb9,
  0xa1, 0x82, 0x75, 0xe9, 0x9f, 0x55, 0x66, 0x6a, 0x86, 0x71, 0xdc, 0x84, 0x56, 0x96, 0x56, 0xa1,
  0x84, 0x78, 0xb7, 0x32, 0x6a, 0x03, 0xe3, 0x02, 0x11, 0x101, 0x08, 0x44, 0x83, 0x100, 0x43, 0xe3,
  0x1c, 0xf0, 0x86, 0x6a, 0x6b, 0x0f, 0x03, 0x2d, 0x86, 0x17, 0x7b, 0x10, 0xf6, 0x80, 0x78, 0x7a,
  0xa1, 0xe1, 0xef, 0x8c, 0xf6, 0x87, 0x4b, 0xa7, 0xe2, 0x77, 0xfa, 0xb8, 0x81, 0xee, 0x77, 0xc0,
  0x9d, 0x29, 0x20, 0x27, 0x71, 0x12, 0xe0, 0x6b, 0xd1, 0x7c, 0x0a, 0x89, 0x7d, 0x87, 0xc4, 0x101,
  0xc1, 0x31, 0xaf, 0x38, 0x03, 0x68, 0x1b, 0x76, 0x79, 0x3f, 0xdb, 0xc7, 0x1b, 0x36, 0x7b, 0xe2,
  0x63, 0x81, 0xee, 0x0c, 0x63, 0x8b, 0x78, 0x38, 0x97, 0x9b, 0xd7, 0x8f, 0xdd, 0xf2, 0xa3, 0x77,
  0x8c, 0xc3, 0x39, 0x20, 0xb3, 0x12, 0x11, 0x0e, 0x17, 0x42, 0x80, 0x2c, 0xc4, 0x92, 0x59, 0xc8,
  0xdb, 0x40, 0x76, 0x64, 0xb4, 0x55, 0x1a, 0x9e, 0xfe, 0x5f, 0x06, 0x3c, 0x41, 0xef, 0xd4, 0xaa,
  0x98, 0x29, 0xcd, 0x1f, 0x02, 0xa8, 0x87, 0xd2, 0xa0, 0x93, 0x98, 0xef, 0x0c, 0x43, 0xed, 0x9d,
  0xc2, 0xeb, 0x81, 0xe9, 0x64, 0x23, 0x68, 0x1e, 0x25, 0x57, 0xde, 0x9a, 0xcf, 0x7f, 0xe5, 0xba,
  0x41, 0xea, 0xea, 0x36, 0x1a, 0x28, 0x79, 0x20, 0x5e, 0x18, 0x4e, 0x7c, 0x8e, 0x58, 0x7a, 0xef,
  0x91, 0x02, 0x93, 0xbb, 0x56, 0xa1, 0x49, 0x1b, 0x79, 0x92, 0xf3, 0x58, 0x4f, 0x52, 0x9c, 0x02,
  0x77, 0xaf, 0x2a, 0x8f, 0x49, 0xd0, 0x99, 0x4d, 0x98, 0x101, 0x60, 0x93, 0x100, 0x75, 0x31, 0xce,
  0x49, 0x20, 0x56, 0x57, 0xe2, 0xf5, 0x26, 0x2b, 0x8a, 0xbf, 0xde, 0xd0, 0x83, 0x34, 0xf4, 0x17,
];

/**
 * Undo a Burrows-Wheeler transform: for each position in the sorted column, the
 * position of the byte that precedes it.
 *
 * The sorted column is the block's own bytes in order, which is why it never
 * has to be stored — counting them is enough to know where each one lands.
 * Following the chain from the block's recorded starting index walks the
 * original text out in order.
 */
export function inverseBwt(block: Uint8Array, length: number): Int32Array {
  const counts = new Int32Array(256);
  const starts = new Int32Array(256);
  for (let i = 0; i < length; i++) counts[block[i]!] = counts[block[i]!]! + 1;

  let total = 0;
  for (let i = 0; i < 256; i++) {
    starts[i] = total;
    total += counts[i]!;
    counts[i] = 0;
  }

  const transform = new Int32Array(length);
  for (let i = 0; i < length; i++) {
    const byte = block[i]!;
    transform[starts[byte]! + counts[byte]!] = i;
    counts[byte] = counts[byte]! + 1;
  }
  return transform;
}

export type ArsenicResult = {
  readonly bytes: Uint8Array;
  /** The CRC-32 the stream carries, or `null` if it ended without one. */
  readonly crc: number | null;
  /** The CRC-32 of what came out, to compare with it. */
  readonly computed: number;
};

const CRC_TABLE = ((): Int32Array => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

/**
 * Decompress one Arsenic stream.
 *
 * `expected` is the length the archive's header promised. It is a limit rather
 * than a target: the stream says for itself where it ends, and a stream that
 * ends early is reported by the caller comparing lengths, not by guessing here
 * that more blocks should have followed.
 */
export function arsenic(bytes: Uint8Array, expected?: number): ArsenicResult {
  const bits = new HighBits(bytes);
  const d: Decoder = { bits, range: ONE, code: bits.string(NUM_BITS) };

  // One model per job. The mtf models split the move-to-front alphabet by
  // magnitude: small distances are common and deserve a model that is not
  // diluted by the 128 rare ones.
  const initial = model(0, 1, 1, 256);
  const selector = model(0, 10, 8, 1024);
  const mtfModels = [
    model(2, 3, 8, 1024),
    model(4, 7, 4, 1024),
    model(8, 15, 4, 1024),
    model(16, 31, 4, 1024),
    model(32, 63, 2, 1024),
    model(64, 127, 2, 1024),
    model(128, 255, 1, 1024),
  ];

  if (numberOf(d, initial, 8) !== 0x41 || numberOf(d, initial, 8) !== 0x73) {
    throw new Error("not an Arsenic stream: it does not begin with 'As'");
  }

  const blockBits = numberOf(d, initial, 4) + 9;
  const blockSize = 1 << blockBits;
  const block = new Uint8Array(blockSize);
  const table = new Uint8Array(256);

  let done = symbolOf(d, initial) !== 0;
  let transform: Int32Array = new Int32Array(0);
  let transformIndex = 0;
  let blockLength = 0;
  let taken = 0;
  let randomized = 0;
  let randomIndex = 0;
  let randomAt = 0;
  let run = 0;
  let last = 0;
  let repeat = 0;
  let crc = 0xffffffff;
  let carried: number | null = null;

  /** Move-to-front: symbol `n` means "the byte `n` places from the front". */
  const fromFront = (n: number): number => {
    const byte = table[n]!;
    for (let i = n; i > 0; i--) table[i] = table[i - 1]!;
    table[0] = byte;
    return byte;
  };

  const readBlock = (): void => {
    for (let i = 0; i < 256; i++) table[i] = i;
    randomized = symbolOf(d, initial);
    transformIndex = numberOf(d, initial, blockBits);
    blockLength = 0;

    for (;;) {
      let selected = symbolOf(d, selector);

      // Zeroes are counted in a bijective base two: each selector contributes
      // one or two of whatever the current place is worth. It is how a run of
      // a hundred thousand identical bytes costs a dozen symbols.
      if (selected === 0 || selected === 1) {
        let place = 1;
        let zeroes = 0;
        while (selected < 2) {
          zeroes += selected === 0 ? place : 2 * place;
          place *= 2;
          selected = symbolOf(d, selector);
        }
        if (blockLength + zeroes > blockSize) throw new Error("Arsenic block overran its size");
        block.fill(fromFront(0), blockLength, blockLength + zeroes);
        blockLength += zeroes;
      }

      if (selected === 10) break;
      const moved = selected === 2 ? 1 : symbolOf(d, mtfModels[selected - 3]!);
      if (blockLength >= blockSize) throw new Error("Arsenic block overran its size");
      block[blockLength++] = fromFront(moved);
    }

    if (transformIndex >= blockLength) throw new Error("Arsenic block starts outside itself");

    // The models that learned this block's habits start again for the next
    // one; the initial model, which codes the framing, carries on.
    resetModel(selector);
    for (const m of mtfModels) resetModel(m);

    if (symbolOf(d, initial)) {
      carried = numberOf(d, initial, 32) >>> 0;
      done = true;
    }

    transform = inverseBwt(block, blockLength);
  };

  const limit = expected ?? Number.POSITIVE_INFINITY;
  const out: number[] = [];

  while (out.length < limit) {
    if (repeat > 0) {
      repeat--;
      out.push(last);
      crc = CRC_TABLE[(crc ^ last) & 0xff]! ^ (crc >>> 8);
      continue;
    }

    if (taken >= blockLength) {
      if (done) break;
      readBlock();
      taken = 0;
      run = 0;
      last = 0;
      randomIndex = 0;
      randomAt = RANDOM[0]!;
    }

    transformIndex = transform[transformIndex]!;
    let byte = block[transformIndex]!;
    if (randomized && randomAt === taken) {
      byte ^= 1;
      randomIndex = (randomIndex + 1) & 255;
      randomAt += RANDOM[randomIndex]!;
    }
    taken++;

    // Four of a kind, and the next byte is how many more follow. Zero is
    // allowed and means exactly four, so nothing is emitted for it.
    if (run === 4) {
      run = 0;
      if (byte === 0) continue;
      repeat = byte - 1;
      byte = last;
    } else if (byte === last) {
      run++;
    } else {
      run = 1;
      last = byte;
    }

    out.push(byte);
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }

  return { bytes: Uint8Array.from(out), crc: carried, computed: ~crc >>> 0 };
}
