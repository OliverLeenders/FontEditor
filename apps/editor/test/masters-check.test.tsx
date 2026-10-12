// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { FakeWorker } from "../../../packages/storage/test/fake-worker.js";
import { clearStoredSettings, installBrowserGlobals } from "./browser-globals.js";
import { installDomStubs, render } from "./render.js";

installBrowserGlobals();

const { Masters } = await import("../src/components/Masters.js");
const { EditorStore } = await import("../src/store/index.js");
const { MemoryFileStore } = await import("@typewright/storage");
const { DEFAULT_SERIF, addContour, contour, node, updateGlyph, withNib } =
  await import("@typewright/font-model");

/**
 * The check between two masters, where they differ in what they should share.
 *
 * With a store that has a working copy behind it, since the check reads the
 * other master where it is parked. What is asked is what somebody sees and can
 * do: that a master missing a glyph is said to be, in words, and that the
 * button beside it puts the glyph there.
 */

beforeAll(() => {
  installDomStubs();
});

afterEach(() => {
  cleanup();
});

const WEIGHT = { tag: "wght", name: "Weight", min: 100, default: 400, max: 900 };

/** A family of two, whose bold has lost its `e` behind the editor's back. */
async function apart() {
  clearStoredSettings();
  const files = new MemoryFileStore();
  const store = new EditorStore();
  await store.connectStorage(new FakeWorker(files) as unknown as Worker, "check");
  await store.setAxes([WEIGHT]);
  await store.addMaster("bold", "Bold", { wght: 900 });

  type Parked = { glyphs: { name: string }[]; info: { glyphOrder?: string[] } };
  const parked = JSON.parse((await files.read("masters/bold.json"))!) as Parked;
  parked.glyphs = parked.glyphs.filter((g) => g.name !== "e");
  if (parked.info.glyphOrder !== undefined) {
    parked.info.glyphOrder = parked.info.glyphOrder.filter((name) => name !== "e");
  }
  await files.write("masters/bold.json", JSON.stringify(parked));
  return store;
}

describe("checking a master against another", () => {
  it("says what they differ in that every master shares, and copies it across", async () => {
    const store = await apart();
    render(<Masters />, store);
    fireEvent.click(screen.getByRole("button", { name: /^Masters/ }));

    const check = screen
      .getAllByRole<HTMLButtonElement>("button", { name: "Check" })
      .find((button) => !button.disabled)!;
    await act(async () => {
      fireEvent.click(check);
      await Promise.resolve();
    });

    expect(await screen.findByText("1 glyph is only in this master: e")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Add to Bold" }));
    await waitFor(() => {
      expect(screen.queryByText("1 glyph is only in this master: e")).toBeNull();
    });
    expect((await store.compareWith("bold"))?.structure.onlyHere).toEqual([]);
  });

  it("says which ends have a serif here and none there, and gives it to them", async () => {
    clearStoredSettings();
    const files = new MemoryFileStore();
    const store = new EditorStore();
    await store.connectStorage(new FakeWorker(files) as unknown as Worker, "ends");

    // A stem with a foot, drawn before there is a second master: so both have it.
    const name = store.editor.document.glyphOrder[0]!;
    const stem = withNib(
      contour(
        "stem",
        [
          node("top", { x: 200, y: 600 }),
          node("foot", { x: 200, y: 0 }, { end: { cut: 0, serif: DEFAULT_SERIF } }),
        ],
        false,
      ),
      { angle: 30, width: 80 },
    );
    const document = updateGlyph(store.editor.document, name, (g) => addContour(g, stem))!;
    store.setEditor({ ...store.editor, document });
    await store.setAxes([WEIGHT]);
    await store.addMaster("bold", "Bold", { wght: 900 });

    // And the bold's foot taken off behind the editor's back.
    const before = (await files.read("masters/bold.json"))!;
    const after = before.replace(/,"serif":\{[^}]*\}/, "");
    expect(after).not.toBe(before);
    await files.write("masters/bold.json", after);

    render(<Masters />, store);
    fireEvent.click(screen.getByRole("button", { name: /^Masters/ }));
    const check = screen
      .getAllByRole<HTMLButtonElement>("button", { name: "Check" })
      .find((button) => !button.disabled)!;
    await act(async () => {
      fireEvent.click(check);
      await Promise.resolve();
    });

    const says = `1 stroke end has another serif, or none, in Bold: ${name}`;
    expect(await screen.findByText(says)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Use this master's" }));
    await waitFor(() => {
      expect(screen.queryByText(says)).toBeNull();
    });
    expect((await store.compareWith("bold"))?.structure.ends).toEqual([]);
  });

  it("says nothing of what they share where they agree in it", async () => {
    clearStoredSettings();
    const store = new EditorStore();
    await store.connectStorage(new FakeWorker(new MemoryFileStore()) as unknown as Worker, "agree");
    await store.setAxes([WEIGHT]);
    await store.addMaster("bold", "Bold", { wght: 900 });
    render(<Masters />, store);
    fireEvent.click(screen.getByRole("button", { name: /^Masters/ }));

    const check = screen
      .getAllByRole<HTMLButtonElement>("button", { name: "Check" })
      .find((button) => !button.disabled)!;
    await act(async () => {
      fireEvent.click(check);
      await Promise.resolve();
    });

    expect(await screen.findByText(/Every glyph can be worked out/)).toBeTruthy();
    expect(screen.queryByText(/differ in what every master shares/)).toBeNull();
  });
});
