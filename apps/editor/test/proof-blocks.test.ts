import { READ_FROM_TEXT } from "@typewright/view";
import { describe, expect, it } from "vitest";

import { MAX_PROOF_SIZE, MIN_PROOF_SIZE } from "../src/limits.js";
import {
  PROOF_LADDER,
  type ProofBlock,
  blockCaption,
  blockId,
  heldSize,
  isPlainBlock,
  ladderBlocks,
  withBlockAdded,
  withBlockRemoved,
  withBlockSettings,
  withBlockSize,
} from "../src/proof-blocks.js";

/**
 * The blocks a waterfall is set as.
 *
 * Every operation on the list is a function of the list, so this is where the
 * rules are tested: the store's one setter and the panel's buttons are both
 * calling these. What is asked of them is that a size is never outside what the
 * proof can be set at, that an identifier is never handed out twice, and that a
 * rule says which block is which when two of them differ.
 */

const ss01: ProofBlock["settings"] = { ...READ_FROM_TEXT, features: { ss01: true } };
const plain = (size: number, id = "block-1"): ProofBlock => ({
  id,
  size,
  settings: READ_FROM_TEXT,
});

describe("a block's size", () => {
  it("is held inside what the proof can be set at", () => {
    expect(heldSize(MIN_PROOF_SIZE - 40)).toBe(MIN_PROOF_SIZE);
    expect(heldSize(MAX_PROOF_SIZE + 40)).toBe(MAX_PROOF_SIZE);
  });

  it("is a whole point, because that is how sizes are spoken of", () => {
    expect(heldSize(11.4)).toBe(11);
    expect(heldSize(11.6)).toBe(12);
  });

  it("falls back rather than becoming nonsense", () => {
    expect(heldSize(Number.NaN)).toBe(MIN_PROOF_SIZE);
  });
});

describe("the ladder", () => {
  it("is the sizes a specimen sheet is set at, in order", () => {
    const blocks = ladderBlocks(READ_FROM_TEXT);
    expect(blocks.map((b) => b.size)).toEqual([...PROOF_LADDER]);
  });

  it("sets every rung the way the bar is set", () => {
    const blocks = ladderBlocks(ss01);
    expect(blocks.every((b) => b.settings === ss01)).toBe(true);
  });

  it("gives every rung its own identifier", () => {
    const blocks = ladderBlocks(READ_FROM_TEXT);
    expect(new Set(blocks.map((b) => b.id)).size).toBe(blocks.length);
  });
});

describe("editing the list", () => {
  it("never repeats an identifier, including one left by a removal", () => {
    // Removing the middle of three leaves a gap, and the next block has to take
    // it rather than the number after the last — which is what a counter would
    // do, and what would make two blocks impossible to tell apart.
    const three = ladderBlocks(READ_FROM_TEXT, [10, 12, 14]);
    const two = withBlockRemoved(three, "block-2");
    const added = withBlockAdded(two, { size: 18, settings: READ_FROM_TEXT });

    expect(new Set(added.map((b) => b.id)).size).toBe(added.length);
  });

  it("adds a block at the last one's size, for the comparison that follows", () => {
    const added = withBlockAdded([plain(24)], { size: 12, settings: ss01 });
    expect(added.map((b) => b.size)).toEqual([24, 24]);
    expect(added[1]?.settings).toBe(READ_FROM_TEXT);
  });

  it("takes the bar's size where there is no block to follow", () => {
    const added = withBlockAdded([], { size: 12, settings: ss01 });
    expect(added.map((b) => b.size)).toEqual([12]);
    expect(added[0]?.settings).toBe(ss01);
  });

  it("holds a size typed into a block", () => {
    const changed = withBlockSize([plain(12)], "block-1", MAX_PROOF_SIZE + 1000);
    expect(changed[0]?.size).toBe(MAX_PROOF_SIZE);
  });

  it("leaves the other blocks alone", () => {
    const two = ladderBlocks(READ_FROM_TEXT, [10, 12]);
    const changed = withBlockSettings(two, "block-2", ss01);
    expect(changed[0]?.settings).toBe(READ_FROM_TEXT);
    expect(changed[1]?.settings).toBe(ss01);
  });

  it("finds an identifier for an empty list", () => {
    expect(blockId([])).toBe("block-1");
  });
});

describe("what a block's rule says", () => {
  it("is the size alone where the block is set like the rest of the page", () => {
    expect(blockCaption(plain(18), READ_FROM_TEXT)).toBe("18 pt");
    expect(isPlainBlock(plain(18), READ_FROM_TEXT)).toBe(true);
  });

  it("names the features where they differ, so the comparison is labelled", () => {
    const block: ProofBlock = { id: "block-1", size: 18, settings: ss01 };
    expect(blockCaption(block, READ_FROM_TEXT)).toBe("18 pt · ss01");
    expect(isPlainBlock(block, READ_FROM_TEXT)).toBe(false);
  });

  it("says which are switched off, because that is a departure too", () => {
    const block: ProofBlock = {
      id: "block-1",
      size: 12,
      settings: { ...READ_FROM_TEXT, features: { liga: false } },
    };
    expect(blockCaption(block, READ_FROM_TEXT)).toBe("12 pt · liga off");
  });

  it("reads the same however the tags were switched", () => {
    const one: ProofBlock = {
      id: "block-1",
      size: 12,
      settings: { ...READ_FROM_TEXT, features: { ss02: true, ss01: true } },
    };
    expect(blockCaption(one, READ_FROM_TEXT)).toBe("12 pt · ss01, ss02");
  });
});
