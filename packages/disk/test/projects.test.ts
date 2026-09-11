import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DiskFolder } from "../src/handles.js";
import {
  FIRST_PROJECT,
  dropProject,
  hashOfWritten,
  listProjects,
  newProject,
  openProjects,
  projectById,
  projectFor,
  saveProject,
  touchProject,
} from "../src/projects.js";
import { rememberFolder } from "../src/remember.js";
import { type FakeFactory, installFakeIdb } from "./fake-idb.js";

/**
 * A folder handle. `isSameEntry` is optional on a real one and absent on plenty
 * of them, so it is given only where a test is about that question.
 */
const folder = (name: string, same: readonly string[] = []): DiskFolder =>
  ({
    name,
    getFileHandle: () => Promise.reject(new Error("not a real folder")),
    isSameEntry: (other: { name: string }) => Promise.resolve(same.includes(other.name)),
  }) as unknown as DiskFolder;

let factory: FakeFactory;
let restore: () => void;

beforeEach(() => {
  ({ factory, restore } = installFakeIdb());
});

afterEach(() => {
  restore();
});

describe("the project list", () => {
  it("is empty before anything has been opened", async () => {
    expect(await listProjects()).toEqual([]);
  });

  it("reads back what was written", async () => {
    const project = newProject("Times", folder("Times.ufo"));
    await saveProject(project);

    const [back] = await listProjects();
    expect(back?.id).toBe(project.id);
    expect(back?.name).toBe("Times");
    expect(back?.folder?.name).toBe("Times.ufo");
  });

  it("puts the most recently opened first", async () => {
    await saveProject({ ...newProject("Older"), id: "a", openedAt: 100 });
    await saveProject({ ...newProject("Newer"), id: "b", openedAt: 300 });
    await saveProject({ ...newProject("Middle"), id: "c", openedAt: 200 });

    expect((await listProjects()).map((it) => it.name)).toEqual(["Newer", "Middle", "Older"]);
  });

  it("brings one to the front when it is touched", async () => {
    await saveProject({ ...newProject("Older"), id: "a", openedAt: 100 });
    await saveProject({ ...newProject("Newer"), id: "b", openedAt: 300 });

    await touchProject("a", 400);
    expect((await listProjects())[0]?.name).toBe("Older");
  });

  it("forgets one on request, and leaves the rest", async () => {
    await saveProject({ ...newProject("One"), id: "a" });
    await saveProject({ ...newProject("Two"), id: "b" });

    await dropProject("a");
    expect((await listProjects()).map((it) => it.name)).toEqual(["Two"]);
    expect(await projectById("a")).toBeNull();
  });

  it("mints a different id for each project", async () => {
    expect(newProject("One").id).not.toBe(newProject("Two").id);
  });

  it("allows a font with no folder, which is a font not yet given one", async () => {
    const started = newProject("Untitled");
    expect(started.folder).toBeNull();

    await saveProject(started);
    expect((await projectById(started.id))?.folder).toBeNull();
  });

  it("ignores a record too damaged to be a project", async () => {
    const store = factory.make("typewright-disk").store("projects");
    store.set("junk", { nothing: true });
    store.set("half", { id: "half" });
    await saveProject({ ...newProject("Real"), id: "real" });

    expect((await listProjects()).map((it) => it.name)).toEqual(["Real"]);
  });
});

describe("finding the project for a folder", () => {
  it("asks the handles whether they are the same place", async () => {
    await saveProject({ ...newProject("Times", folder("Times.ufo", ["Times.ufo"])), id: "a" });

    expect((await projectFor(folder("Times.ufo")))?.id).toBe("a");
  });

  it("falls back to the name when the handles will not say", async () => {
    const plain = { name: "Plain.ufo", getFileHandle: () => Promise.reject(new Error("no")) };
    await saveProject({ ...newProject("Plain", plain as unknown as DiskFolder), id: "b" });

    expect((await projectFor(plain as unknown as DiskFolder))?.id).toBe("b");
  });

  it("is null for a folder nothing has been opened from", async () => {
    await saveProject({ ...newProject("Times", folder("Times.ufo")), id: "a" });
    expect(await projectFor(folder("Helvetica.ufo"))).toBeNull();
  });

  it("does not match a project that has no folder at all", async () => {
    await saveProject({ ...newProject("Untitled"), id: "a" });
    expect(await projectFor(folder("Anything.ufo"))).toBeNull();
  });
});

describe("the hash of what was written", () => {
  it("does not depend on the order the files were written in", () => {
    const one = hashOfWritten([
      ["b.glif", { crc: 2, at: 0 }],
      ["a.glif", { crc: 1, at: 0 }],
    ]);
    const two = hashOfWritten([
      ["a.glif", { crc: 1, at: 0 }],
      ["b.glif", { crc: 2, at: 0 }],
    ]);
    expect(one).toBe(two);
  });

  it("changes when a file's contents change", () => {
    const before = hashOfWritten([["a.glif", { crc: 1, at: 0 }]]);
    const after = hashOfWritten([["a.glif", { crc: 2, at: 0 }]]);
    expect(before).not.toBe(after);
  });

  it("changes when a file is added or removed", () => {
    const one = hashOfWritten([["a.glif", { crc: 1, at: 0 }]]);
    const two = hashOfWritten([
      ["a.glif", { crc: 1, at: 0 }],
      ["b.glif", { crc: 1, at: 0 }],
    ]);
    expect(one).not.toBe(two);
  });

  it("does not change when only a timestamp moves", () => {
    const before = hashOfWritten([["a.glif", { crc: 1, at: 100 }]]);
    const after = hashOfWritten([["a.glif", { crc: 1, at: 900 }]]);
    expect(before).toBe(after);
  });
});

describe("the first run after a single remembered folder", () => {
  it("adopts it as the first project", async () => {
    await rememberFolder(folder("Times.ufo"), new Map([["a.glif", { crc: 1, at: 2 }]]));

    const [adopted] = await openProjects();
    expect(adopted?.name).toBe("Times.ufo");
    expect(adopted?.folder?.name).toBe("Times.ufo");
    expect(adopted?.savedHash).toBe(hashOfWritten([["a.glif", { crc: 1, at: 2 }]]));
  });

  it("keeps the working copy's old name as the id, so the font is not lost", async () => {
    await rememberFolder(folder("Times.ufo"));
    expect((await openProjects())[0]?.id).toBe(FIRST_PROJECT);
  });

  it("says nothing about a save that never happened", async () => {
    await rememberFolder(folder("Times.ufo"));

    const [adopted] = await openProjects();
    expect(adopted?.savedAt).toBeNull();
    expect(adopted?.savedHash).toBeNull();
  });

  it("does it once, and leaves the list alone afterwards", async () => {
    await rememberFolder(folder("Times.ufo"));
    await openProjects();

    await dropProject(FIRST_PROJECT);
    await saveProject({ ...newProject("Something else"), id: "b" });

    expect((await openProjects()).map((it) => it.name)).toEqual(["Something else"]);
  });

  it("is empty when there was nothing to adopt", async () => {
    expect(await openProjects()).toEqual([]);
  });
});
