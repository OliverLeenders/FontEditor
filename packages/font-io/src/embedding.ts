/**
 * The embedding permissions, as `fsType` bit numbers, from wherever they are read.
 *
 * A UFO lists them and a binary packs them into one number, and both can say
 * something the format does not allow. Only the bits the format defines are
 * kept, and one level at most: a font that sets two gets the less restrictive,
 * which is what the specification tells a reader to honour — and a font read in
 * with two would refuse every later edit in Font Info.
 */
export function embeddingBits(listed: readonly unknown[]): number[] {
  const defined = listed.filter(
    (bit): bit is number => typeof bit === "number" && [1, 2, 3, 8, 9].includes(bit),
  );
  const level = Math.max(0, ...defined.filter((bit) => bit <= 3));
  const flags = [...new Set(defined.filter((bit) => bit > 3))];
  return [...(level === 0 ? [] : [level]), ...flags].sort((a, b) => a - b);
}

/** The bit numbers set in a 16-bit field. */
export function setBits(value: number): number[] {
  const bits: number[] = [];
  for (let bit = 0; bit < 16; bit++) if ((value & (1 << bit)) !== 0) bits.push(bit);
  return bits;
}
