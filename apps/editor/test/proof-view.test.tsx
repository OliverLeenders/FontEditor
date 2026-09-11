// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { installBrowserGlobals } from "./browser-globals.js";
import { freshStore, installDomStubs, render } from "./render.js";

installBrowserGlobals();

const { ProofView } = await import("../src/components/ProofView.js");
const { PROOF_SPECIMENS } = await import("../src/specimens.js");

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
    expect(button.title).toBe("This font defines no features yet");
  });

  it("turns the font's features off and on again", () => {
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
    expect(store.getState().applyFeatures).toBe(!before);
    expect(screen.getByRole("button", { name: "Features" }).getAttribute("aria-pressed")).toBe(
      String(!before),
    );
  });
});
