// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { installBrowserGlobals } from "./browser-globals.js";
import { freshStore, installDomStubs, render } from "./render.js";

installBrowserGlobals();

const { ProofView } = await import("../src/components/ProofView.js");
const { PROOF_SPECIMENS } = await import("../src/specimens.js");
const { PROOF_LADDER, drawnSize } = await import("../src/proof-blocks.js");
const { EMPTY_KERNING, setKern } = await import("@typewright/font-model");

/**
 * The proof: the font set as text, and the controls for how it is set.
 *
 * The drawing is the render package's, and a canvas here draws into nothing.
 * What is asked is that each control writes the setting it names, that the
 * features switch is only offered when there are features to switch, and that
 * text which is not one of the specimens is shown as what it is rather than as
 * whichever specimen happens to be first.
 */

beforeAll(() => {
  installDomStubs();
  // The surface refuses to exist without a context, and jsdom provides none.
  // One that accepts everything and draws nothing is enough: the picture is
  // tested where it is drawn.
  const canvas = HTMLCanvasElement.prototype as unknown as Record<string, unknown>;
  canvas["getContext"] = (): unknown =>
    new Proxy(
      {
        measureText: () => ({ width: 0 }),
        getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
      },
      {
        get: (target, key) =>
          key in target ? target[key as keyof typeof target] : () => undefined,
      },
    );
  const globals = globalThis as unknown as Record<string, unknown>;
  if (typeof globals["requestAnimationFrame"] !== "function") {
    globals["requestAnimationFrame"] = (run: () => void): number =>
      setTimeout(run, 16) as unknown as number;
    globals["cancelAnimationFrame"] = (id: number): void => clearTimeout(id);
  }
});

afterEach(() => {
  cleanup();
});

describe("setting the proof", () => {
  it("takes its size from the slider", () => {
    const { store } = render(<ProofView />);

    fireEvent.change(screen.getByLabelText("Type size"), { target: { value: "48" } });

    expect(store.getState().proofSize).toBe(48);
    expect(screen.getByText("48")).toBeTruthy();
  });

  it("takes its leading from the other one", () => {
    const { store } = render(<ProofView />);

    fireEvent.change(screen.getByLabelText("Line spacing"), { target: { value: "1.5" } });

    expect(store.getState().proofLeading).toBe(1.5);
  });

  it("sets whatever is typed beneath it", () => {
    const { store } = render(<ProofView />);

    fireEvent.change(screen.getByLabelText("Proof text"), { target: { value: "Hamburgefonstiv" } });

    expect(store.getState().proofText).toBe("Hamburgefonstiv");
    expect(screen.getByText("1 line")).toBeTruthy();
  });
});

describe("text the font has not all of", () => {
  const said = (): string | null => screen.queryByText(/^No glyph for /)?.textContent ?? null;

  // The starter font has h, e, l, o, c, i, n and space.
  it("is said beside the count, each piece once and as it was typed", () => {
    const { store } = render(<ProofView />);

    act(() => store.setProofText("hello/uni03B1 hexxo"));

    expect(said()).toBe("No glyph for /uni03B1 x");
  });

  it("is not said of the end of a line, nor once the text is mended", () => {
    const { store } = render(<ProofView />);

    act(() => store.setProofText("hello\nhello/nothing"));
    expect(said()).toBe("No glyph for /nothing");

    act(() => store.setProofText("hello\nhello/U+006F"));
    expect(said()).toBeNull();
  });
});

describe("specimens", () => {
  it("replace the text with the one chosen", () => {
    const { store } = render(<ProofView />);
    const chosen = PROOF_SPECIMENS[PROOF_SPECIMENS.length - 1];
    if (chosen === undefined) throw new Error("no specimens");

    fireEvent.change(screen.getByLabelText("Specimen"), { target: { value: chosen.name } });

    expect(store.getState().proofText).toBe(chosen.text);
  });

  it("call text that is none of them Custom, instead of naming the first", () => {
    const store = freshStore();
    act(() => {
      store.setProofText("Nothing anybody would ship as a specimen");
    });
    render(<ProofView />, store);

    expect(screen.getByLabelText<HTMLSelectElement>("Specimen").value).toBe("");
    expect(screen.getByRole("option", { name: "Custom" })).toBeTruthy();
  });
});

describe("the features switch", () => {
  it("is not offered for a font with no features", () => {
    const store = freshStore();
    act(() => {
      store.setEditor({ ...store.editor, document: { ...store.editor.document, features: "" } });
    });
    render(<ProofView />, store);

    const button = screen.getByRole<HTMLButtonElement>("button", { name: "Features" });
    expect(button.disabled).toBe(true);
    expect(button.title).toBe("This font has no features, kerning or anchors to set yet");
  });

  it("is offered for a font with kerning and no feature file", () => {
    // HarfBuzz sets kerning and marks with no feature file at all, and a switch
    // greyed out for want of one kept those out of the proof.
    const store = freshStore();
    act(() => {
      store.setEditor({
        ...store.editor,
        document: {
          ...store.editor.document,
          features: "",
          kerning: setKern(EMPTY_KERNING, "o", "o", -20),
        },
      });
    });
    render(<ProofView />, store);

    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Features" }).disabled).toBe(
      false,
    );
  });

  it("turns the font's features off and on again, from the panel", () => {
    const store = freshStore();
    act(() => {
      store.setEditor({
        ...store.editor,
        document: { ...store.editor.document, features: "languagesystem DFLT dflt;\n" },
      });
    });
    render(<ProofView />, store);
    const before = store.getState().applyFeatures;

    fireEvent.click(screen.getByRole("button", { name: "Features" }));
    fireEvent.click(screen.getByLabelText("Apply the font's features"));
    expect(store.getState().applyFeatures).toBe(!before);
  });

  it("remembers a feature switched on in the bar", () => {
    const store = freshStore();
    act(() => {
      store.setEditor({
        ...store.editor,
        document: {
          ...store.editor.document,
          features: "feature ss01 {\n  sub a by b;\n} ss01;\n",
        },
      });
    });
    render(<ProofView />, store);

    fireEvent.click(screen.getByRole("button", { name: "Features" }));
    fireEvent.click(screen.getByLabelText("ss01"));
    expect(store.getState().proofTextSettings.features).toEqual({ ss01: true });
  });
});

describe("the waterfall", () => {
  /** A font with a stylistic set, so a block has something of its own to switch. */
  const withSet = () => {
    const store = freshStore();
    act(() => {
      store.setEditor({
        ...store.editor,
        document: {
          ...store.editor.document,
          features: "feature ss01 {\n  sub a by b;\n} ss01;\n",
        },
      });
    });
    return store;
  };

  const chooseWaterfall = (): void => {
    fireEvent.change(screen.getByLabelText("How the proof is set"), {
      target: { value: "waterfall" },
    });
  };

  /** Press the chip of the `n`th size, which puts its field and features after the chips. */
  const chooseSize = (n: number): void => {
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^Size ${String(n)}:`) }));
  };

  it("fills in the ladder when it is chosen, because an empty one is a blank page", () => {
    const { store } = render(<ProofView />);

    chooseWaterfall();

    expect(store.getState().proofBlocks.map((b) => b.size)).toEqual([...PROOF_LADDER]);
  });

  it("puts the size slider away, because each block carries its own size", () => {
    render(<ProofView />);
    expect(screen.queryByLabelText("Type size")).not.toBeNull();

    chooseWaterfall();

    expect(screen.queryByLabelText("Type size")).toBeNull();
    chooseSize(1);
    expect(screen.getByLabelText("Size of block 1")).toBeTruthy();
  });

  it("gives the page back its one size, and keeps the slider's", () => {
    const { store } = render(<ProofView />);
    fireEvent.change(screen.getByLabelText("Type size"), { target: { value: "48" } });

    chooseWaterfall();
    fireEvent.change(screen.getByLabelText("How the proof is set"), { target: { value: "one" } });

    expect(store.getState().proofBlocks).toEqual([]);
    expect(store.getState().proofSize).toBe(48);
  });

  it("takes a block's size from its own field", () => {
    const { store } = render(<ProofView />);
    chooseWaterfall();
    chooseSize(2);

    fireEvent.change(screen.getByLabelText("Size of block 2"), { target: { value: "30" } });

    const sizes = store.getState().proofBlocks.map((b) => b.size);
    expect(sizes[1]).toBe(30);
    expect(sizes[0]).toBe(PROOF_LADDER[0]);
  });

  it("holds a size nobody could set the proof at", () => {
    const { store } = render(<ProofView />);
    chooseWaterfall();
    chooseSize(1);

    fireEvent.change(screen.getByLabelText("Size of block 1"), { target: { value: "4000" } });

    expect(store.getState().proofBlocks[0]?.size).toBe(140);
  });

  it("takes a block off the page", () => {
    const { store } = render(<ProofView />);
    chooseWaterfall();
    const before = store.getState().proofBlocks.length;

    fireEvent.click(screen.getByLabelText("Remove size 1"));

    const after = store.getState().proofBlocks;
    expect(after).toHaveLength(before - 1);
    expect(after[0]?.size).toBe(PROOF_LADDER[1]);
  });

  it("adds a block at the last one's size, for a comparison at one size", () => {
    const { store } = render(<ProofView />);
    chooseWaterfall();

    fireEvent.click(screen.getByRole("button", { name: "Add a size" }));

    const sizes = store.getState().proofBlocks.map((b) => b.size);
    expect(sizes).toHaveLength(PROOF_LADDER.length + 1);
    expect(sizes[sizes.length - 1]).toBe(PROOF_LADDER[PROOF_LADDER.length - 1]);
  });

  it("switches a feature in one block and leaves the others as they were", () => {
    // The whole point of blocks over a plain ladder: two settings on one page.
    const store = withSet();
    render(<ProofView />, store);
    chooseWaterfall();

    // The bar has one of these too, and it comes first; the chosen size's is
    // the second.
    chooseSize(2);
    const panels = screen.getAllByRole("button", { name: "Features" });
    fireEvent.click(panels[1]!);
    fireEvent.click(screen.getByLabelText("ss01"));

    const blocks = store.getState().proofBlocks;
    expect(blocks[1]?.settings.features).toEqual({ ss01: true });
    expect(blocks[0]?.settings.features).toEqual({});
    // The bar is not a block, and switching one block is not switching the page.
    expect(store.getState().proofTextSettings.features).toEqual({});
    // And the chip says so, for when it is not the one chosen.
    expect(screen.getByRole("button", { name: /^Size 2: .*its own features/ })).toBeTruthy();
  });

  it("zooms the page without touching the sizes, and says so until it is reset", () => {
    const { store } = render(<ProofView />);
    chooseWaterfall();

    act(() => {
      store.setProofZoom(1.5);
    });
    expect(store.getState().proofBlocks.map((b) => b.size)).toEqual([...PROOF_LADDER]);
    const zoom = screen.getByRole("button", { name: "Zoom 150%" });

    fireEvent.click(zoom);
    expect(store.getState().proofZoom).toBe(1);
    expect(screen.queryByRole("button", { name: /^Zoom/ })).toBeNull();
  });

  it("fills the page from another ladder", () => {
    const { store } = render(<ProofView />);
    chooseWaterfall();

    fireEvent.click(screen.getByRole("button", { name: /^Ladder/ }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /^Display sizes/ }));

    expect(store.getState().proofBlocks.map((b) => b.size)).toEqual([
      18, 24, 30, 36, 48, 60, 72, 96,
    ]);
  });
});

describe("drawnSize", () => {
  it("scales a size by the zoom, held inside the proof's sizes and never rounded", () => {
    expect(drawnSize(12, 1.25)).toBe(15);
    expect(drawnSize(11, 1.1)).toBeCloseTo(12.1);
    expect(drawnSize(72, 4)).toBe(140);
    expect(drawnSize(8, 0.5)).toBe(8);
  });
});
