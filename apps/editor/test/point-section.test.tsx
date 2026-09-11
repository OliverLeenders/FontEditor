// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { installBrowserGlobals } from "./browser-globals.js";
import { freshStore, installDomStubs, render } from "./render.js";

installBrowserGlobals();

const { PointSection } = await import("../src/components/inspector/PointSection.js");
const { selectedCanBeTangent } = await import("@typewright/tools");

/**
 * The selected point, by number: its kind, where it is, and what its handles do.
 *
 * Every field here is also a drag on the canvas, and the drags are tested in
 * tools. What is asked here is that each field shows what the model holds and
 * writes where it says — including the cases where it must refuse to show a
 * number at all, because any number it showed would be one arbitrary point's.
 */

type Store = ReturnType<typeof freshStore>;
type Node = {
  id: string;
  pt: { x: number; y: number };
  in: unknown;
  out: { x: number; y: number } | null;
  type: string;
};

beforeAll(() => {
  installDomStubs();
});

afterEach(() => {
  cleanup();
});

/** A store on the first glyph with outlines, selecting the nodes `pick` chooses. */
function selecting(
  pick: (
    nodes: readonly { contourId: string; node: Node }[],
  ) => readonly { contourId: string; node: Node }[],
): { store: Store; picked: readonly { contourId: string; node: Node }[] } {
  const store = freshStore();
  let picked: readonly { contourId: string; node: Node }[] = [];
  act(() => {
    const document = store.editor.document;
    for (const name of document.glyphOrder) {
      const glyph = document.glyphs[name];
      const nodes = (glyph?.contours ?? []).flatMap((c) =>
        c.nodes.map((n) => ({ contourId: c.id, node: n as unknown as Node })),
      );
      const chosen = pick(nodes);
      if (chosen.length === 0) continue;

      store.setCurrentGlyph(name);
      store.setEditor({
        ...store.editor,
        selection: chosen.map((it) => ({
          contourId: it.contourId,
          nodeId: it.node.id,
          part: "point" as const,
        })),
      });
      picked = chosen;
      return;
    }
    throw new Error("no glyph in the starter font has what this test needs");
  });
  return { store, picked };
}

function nodeNow(store: Store, contourId: string, nodeId: string): Node {
  const glyph = store.editor.document.glyphs[store.editor.currentGlyph];
  const found = glyph?.contours.find((c) => c.id === contourId)?.nodes.find((n) => n.id === nodeId);
  if (found === undefined) throw new Error("the node is gone");
  return found as unknown as Node;
}

const input = (label: string) => screen.getByLabelText<HTMLInputElement>(label);

describe("one selected point", () => {
  it("shows where it is", () => {
    const { store, picked } = selecting((nodes) => nodes.slice(0, 1));
    render(<PointSection />, store);

    const pt = picked[0]?.node.pt;
    expect(Number(input("X position").value)).toBeCloseTo(pt?.x ?? NaN, 1);
    expect(Number(input("Y position").value)).toBeCloseTo(pt?.y ?? NaN, 1);
  });

  it("moves to a typed coordinate, on that axis alone", () => {
    const { store, picked } = selecting((nodes) => nodes.slice(0, 1));
    const target = picked[0];
    if (target === undefined) throw new Error("nothing picked");
    render(<PointSection />, store);

    fireEvent.change(input("X position"), { target: { value: String(target.node.pt.x + 30) } });

    const moved = nodeNow(store, target.contourId, target.node.id);
    expect(moved.pt.x).toBeCloseTo(target.node.pt.x + 30, 6);
    expect(moved.pt.y).toBeCloseTo(target.node.pt.y, 6);
  });
});

describe("several selected points", () => {
  it("shows no position, rather than one of theirs", () => {
    const { store } = selecting((nodes) => nodes.slice(0, 2));
    render(<PointSection />, store);

    expect(input("X position").disabled).toBe(true);
    expect(input("X position").value).toBe("");
    expect(screen.getByText("2 selected")).toBeTruthy();
  });

  it("are all given the type pressed", () => {
    const { store, picked } = selecting((nodes) => nodes.slice(0, 3));
    render(<PointSection />, store);

    fireEvent.click(screen.getByRole("button", { name: "Corner" }));

    for (const it of picked) {
      expect(nodeNow(store, it.contourId, it.node.id).type).toBe("corner");
    }
    expect(screen.getByRole("button", { name: "Corner" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });
});

describe("tangent", () => {
  it("is offered exactly where it would be true", () => {
    const { store } = selecting((nodes) => nodes.slice(0, 1));
    render(<PointSection />, store);

    const tangent = screen.getByRole<HTMLButtonElement>("button", { name: "Tangent" });
    expect(tangent.disabled).toBe(!selectedCanBeTangent(store.editor));
  });
});

describe("handles", () => {
  it("cannot be typed into on a side with no handle", () => {
    const { store } = selecting((nodes) => nodes.filter((it) => it.node.in === null).slice(0, 1));
    render(<PointSection />, store);

    expect(input("Length of the incoming handle").disabled).toBe(true);
  });

  it("reach as far as a typed length, in the direction they already point", () => {
    const { store, picked } = selecting((nodes) =>
      nodes
        .filter(
          (it) =>
            it.node.out !== null &&
            Math.hypot(it.node.out.x - it.node.pt.x, it.node.out.y - it.node.pt.y) > 1,
        )
        .slice(0, 1),
    );
    const target = picked[0];
    if (target?.node.out == null) throw new Error("nothing picked");
    const before = Math.hypot(
      target.node.out.x - target.node.pt.x,
      target.node.out.y - target.node.pt.y,
    );
    const direction = Math.atan2(
      target.node.out.y - target.node.pt.y,
      target.node.out.x - target.node.pt.x,
    );
    render(<PointSection />, store);

    fireEvent.change(input("Length of the outgoing handle"), {
      target: { value: String(before + 20) },
    });

    const moved = nodeNow(store, target.contourId, target.node.id);
    if (moved.out === null) throw new Error("the handle is gone");
    const dx = moved.out.x - moved.pt.x;
    const dy = moved.out.y - moved.pt.y;
    expect(Math.hypot(dx, dy)).toBeCloseTo(before + 20, 3);
    expect(Math.atan2(dy, dx)).toBeCloseTo(direction, 3);
  });
});
