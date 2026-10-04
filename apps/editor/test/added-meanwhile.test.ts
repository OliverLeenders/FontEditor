import { describe, expect, it } from "vitest";

import { type Files, WEIGHT, opened } from "./walk-harness.js";

const { MemoryFileStore } = await import("@typewright/storage");

/**
 * Adding a master parks a copy of the whole font, which for a large one is
 * seconds, and the project is changed once it is parked. It was changed to
 * what had been worked out before the parking began — so whatever was done to
 * the project in those seconds was undone when they ended.
 */
describe("a master added while something else changes the project", () => {
  it("keeps what was done while its drawing was being parked", async () => {
    const files: Files = new MemoryFileStore();
    const store = await opened(files);
    await store.setAxes([WEIGHT]);

    // A style named at the moment the new master's file is written.
    const write = files.write.bind(files);
    const named: Promise<void>[] = [];
    files.write = async (path, text) => {
      if (named.length === 0 && path.includes("light")) {
        named.push(store.addInstance("semi", "Semibold", { wght: 600 }));
      }
      await write(path, text);
    };

    await store.addMaster("light", "Light", { wght: 100 });
    expect(named.length, "the file was written, and the style named as it was").toBe(1);
    await Promise.all(named);

    const { masters, instances } = store.getState().project;
    expect(masters.map((m) => m.id)).toContain("light");
    expect(instances.map((it) => it.name)).toEqual(["Semibold"]);

    // And on disk, where the next session reads it.
    await store.flushNow();
    const again = await opened(files);
    expect(again.getState().project.instances.map((it) => it.name)).toEqual(["Semibold"]);
    expect(again.getState().project.masters.map((m) => m.id)).toContain("light");
  });
});
