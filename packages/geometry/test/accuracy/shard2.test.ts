import { describe, expect, it } from "vitest";

import { MOST, shortOfInk } from "./census.js";

describe.skipIf(process.env["STROKE_ACCURACY"] === undefined)(
  "the ink planned for a variable font",
  () => {
    it("leaves ink out of no more masters than it did: shard 2", { timeout: 14_400_000 }, () => {
      const short = shortOfInk(2);
      process.stdout.write(`\nShard 2: ${String(short.length)} masters short of ink\n`);
      expect(short.length, short.join("\n")).toBeLessThanOrEqual(MOST[2]!);
    });
  },
);
