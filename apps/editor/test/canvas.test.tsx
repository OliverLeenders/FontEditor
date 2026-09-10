// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { installBrowserGlobals } from "./browser-globals.js";
import { freshStore, installDomStubs, render } from "./render.js";
import type { MenuRequest } from "../src/components/ContextMenu.js";

installBrowserGlobals();

const { GlyphCanvas } = await import("../src/components/GlyphCanvas.js");
const { toScreen } = await import("@typewright/view");
const { tunniLambdas, tunniPoint } = await import("@typewright/geometry");
const { segmentCubic, segments } = await import("@typewright/font-model");

/** The store, named for the tests: the components are imported dynamically. */
type Store = ReturnType<typeof freshStore>;

/**
 * The drawing surface, driven the way a hand drives it.
 *
 * Everything else in this app is tested where it lives — the tools are pure
 * reducers with their own suites, and the panels are rendered against a real
 * store. The canvas was the gap: it is the component that turns a pointer into
 * a tool call, and the only one where a wrong sign or a missed modifier shows
 * up as "the editor does nothing" rather than as a failing assertion anywhere.
 *
 * So these are pointer sequences at design coordinates, and the questions are
 * the ones a person would ask: did clicking there select it, did dragging it
 * move it, did the knife cut the shape, did the pen leave a contour behind.
 * What is asserted is always the document or the selection, never the markup:
 * nothing here can be satisfied by a canvas that draws the right picture and
 * edits nothing.
 */

beforeAll(() => {
  installDomStubs();
  installCanvasStubs();
});

afterEach(() => {
  cleanup();
});

/** A store open on a glyph with square corners at coordinates worth typing. */
function storeOn(glyphName = "l"): Store {
  const store = freshStore();
  act(() => {
    store.setCurrentGlyph(glyphName);
    // A view that is not the identity, so a test cannot pass by accident on a
    // transform that does nothing: half size, and moved away from the corner.
    store.setView({ scale: 0.5, tx: 120, ty: 500 });
  });
  return store;
}

/** That store, with the canvas on screen in front of it. */
function onCanvas(glyphName = "l"): { store: Store; canvas: HTMLCanvasElement } {
  const store = storeOn(glyphName);
  render(<GlyphCanvas onContextMenu={() => undefined} />, store);
  return { store, canvas: theCanvas() };
}

const theCanvas = (): HTMLCanvasElement =>
  screen.getByLabelText<HTMLCanvasElement>("Glyph editing canvas");

/** Where the segment showing its controls has its Tunni point, in design units. */
function tunniOf(store: Store): { x: number; y: number } | null {
  const segment = liveCubic(store);
  return segment === null ? null : tunniPoint(segment);
}

/**
 * The segment whose controls are up, as a cubic.
 *
 * Focused first and hovered second, which is the order the editor itself keeps
 * them in: the thing being worked on outranks the thing under the pointer.
 */
function liveCubic(store: Store) {
  const editor = store.editor;
  const ref = editor.focusedSegment ?? editor.hoveredSegment;
  const glyph = editor.document.glyphs[editor.currentGlyph];
  if (ref === null || glyph === undefined) return null;

  const contour = glyph.contours.find((c) => c.id === ref.contourId);
  const segment = contour === undefined ? undefined : segments(contour)[ref.segmentIndex];
  return segment === undefined ? null : segmentCubic(segment);
}

/** How far each handle reaches, which is what a Tunni drag changes. */
function scalesOf(store: Store) {
  const cubic = liveCubic(store);
  return cubic === null ? null : tunniLambdas(cubic);
}

/** A pointer event's client coordinates for a place in the glyph. */
function at(store: Store, x: number, y: number): { clientX: number; clientY: number } {
  const screenPoint = toScreen(store.editor.view, { x, y });
  return { clientX: screenPoint.x, clientY: screenPoint.y };
}

/** Press, move through each waypoint, release — one drag, as a hand does it. */
function drag(
  canvas: HTMLCanvasElement,
  store: Store,
  from: readonly [number, number],
  ...waypoints: readonly (readonly [number, number])[]
): void {
  const last = waypoints[waypoints.length - 1] ?? from;
  act(() => {
    fireEvent.pointerDown(canvas, { button: 0, ...at(store, from[0], from[1]) });
    for (const [x, y] of waypoints) fireEvent.pointerMove(canvas, at(store, x, y));
    fireEvent.pointerUp(canvas, { button: 0, ...at(store, last[0], last[1]) });
  });
}

/** Press and release without moving. */
function click(
  canvas: HTMLCanvasElement,
  store: Store,
  x: number,
  y: number,
  modifiers: { shiftKey?: boolean } = {},
): void {
  act(() => {
    fireEvent.pointerDown(canvas, { button: 0, ...at(store, x, y), ...modifiers });
    fireEvent.pointerUp(canvas, { button: 0, ...at(store, x, y), ...modifiers });
  });
}

/** The nodes of the glyph on screen, in the order the contour holds them. */
function nodesOf(store: Store, contour = 0) {
  const glyph = store.editor.document.glyphs[store.editor.currentGlyph];
  return glyph?.contours[contour]?.nodes ?? [];
}

describe("selecting on the canvas", () => {
  it("selects the node that was clicked", () => {
    const { store, canvas } = onCanvas();
    const corner = nodesOf(store)[0];

    click(canvas, store, 100, 0);

    expect(store.editor.selection).toHaveLength(1);
    expect(store.editor.selection[0]?.nodeId).toBe(corner?.id);
    expect(store.editor.selection[0]?.part).toBe("point");
  });

  it("clears the selection when the click lands on nothing", () => {
    const { store, canvas } = onCanvas();
    click(canvas, store, 100, 0);
    expect(store.editor.selection).toHaveLength(1);

    click(canvas, store, -400, 900);

    expect(store.editor.selection).toHaveLength(0);
  });

  it("takes everything a marquee is drawn round", () => {
    const { store, canvas } = onCanvas();

    // A box well clear of the stem on every side, drawn from empty canvas.
    drag(canvas, store, [-100, -100], [0, 200], [400, 900]);

    expect(store.editor.selection).toHaveLength(4);
  });

  it("adds to the selection with shift held", () => {
    const { store, canvas } = onCanvas();

    click(canvas, store, 100, 0);
    click(canvas, store, 200, 0, { shiftKey: true });

    expect(store.editor.selection).toHaveLength(2);
  });
});

describe("dragging on the canvas", () => {
  it("moves the node the drag started on", () => {
    const { store, canvas } = onCanvas();

    drag(canvas, store, [100, 0], [130, 20], [150, 40]);

    const moved = nodesOf(store)[0];
    expect(moved?.pt.x).toBeCloseTo(150, 6);
    expect(moved?.pt.y).toBeCloseTo(40, 6);
  });

  it("is one undo step from press to release", () => {
    const { store, canvas } = onCanvas();

    drag(canvas, store, [100, 0], [120, 10], [150, 40]);
    act(() => {
      store.undo();
    });

    const back = nodesOf(store)[0];
    expect(back?.pt.x).toBeCloseTo(100, 6);
    expect(back?.pt.y).toBeCloseTo(0, 6);
  });

  it("carries the whole selection, not only what is under the pointer", () => {
    const { store, canvas } = onCanvas();
    drag(canvas, store, [-100, -100], [400, 900]);
    expect(store.editor.selection).toHaveLength(4);

    // From inside the box, which is where a drag takes everything with it.
    drag(canvas, store, [150, 350], [170, 350], [200, 350]);

    const xs = nodesOf(store).map((n) => Math.round(n.pt.x));
    expect(xs).toEqual([150, 250, 250, 150]);
  });
});

describe("the keyboard on the canvas", () => {
  it("nudges the selection by an arrow key", () => {
    const { store, canvas } = onCanvas();
    click(canvas, store, 100, 0);

    act(() => {
      fireEvent.keyDown(canvas, { key: "ArrowRight" });
    });

    expect(nodesOf(store)[0]?.pt.x).toBeGreaterThan(100);
  });

  it("gives up the drawing tool on Escape", () => {
    const { store, canvas } = onCanvas();
    act(() => {
      store.setTool("pen");
    });
    click(canvas, store, 300, 300);
    expect(store.editor.pen).not.toBeNull();

    act(() => {
      fireEvent.keyDown(canvas, { key: "Escape" });
    });

    expect(store.editor.pen).toBeNull();
  });
});

describe("drawing with the pen", () => {
  it("leaves a closed contour behind", () => {
    const { store, canvas } = onCanvas();
    const before = store.editor.document.glyphs["l"]?.contours.length ?? 0;
    act(() => {
      store.setTool("pen");
    });

    click(canvas, store, 400, 100);
    click(canvas, store, 500, 100);
    click(canvas, store, 500, 300);
    // Back onto the first point, which is how a contour is closed.
    click(canvas, store, 400, 100);

    const contours = store.editor.document.glyphs["l"]?.contours ?? [];
    expect(contours).toHaveLength(before + 1);
    const drawn = contours[contours.length - 1];
    expect(drawn?.closed).toBe(true);
    expect(drawn?.nodes).toHaveLength(3);
  });
});

describe("cutting with the knife", () => {
  it("splits the contour where the cut crossed it", () => {
    const { store, canvas } = onCanvas();
    const before = nodesOf(store).length;
    act(() => {
      store.setTool("knife");
    });

    // Straight across the stem, well clear of its corners.
    drag(canvas, store, [50, 350], [150, 350], [250, 350]);

    const glyph = store.editor.document.glyphs["l"];
    const nodes = (glyph?.contours ?? []).reduce((n, c) => n + c.nodes.length, 0);
    expect(nodes).toBeGreaterThan(before);
  });
});

describe("moving the view rather than the font", () => {
  it("pans with the middle button and changes nothing else", () => {
    const { store, canvas } = onCanvas();
    const document = store.editor.document;
    const { tx, ty } = store.editor.view;

    act(() => {
      fireEvent.pointerDown(canvas, { button: 1, clientX: 200, clientY: 200 });
      fireEvent.pointerMove(canvas, { clientX: 260, clientY: 230 });
      fireEvent.pointerUp(canvas, { button: 1, clientX: 260, clientY: 230 });
    });

    expect(store.editor.view.tx).toBeCloseTo(tx + 60, 6);
    expect(store.editor.view.ty).toBeCloseTo(ty + 30, 6);
    // The same document object, not merely an equal one: panning is not an edit.
    expect(store.editor.document).toBe(document);
  });

  it("zooms about the pointer with ctrl held", () => {
    const { store, canvas } = onCanvas();
    const before = store.editor.view.scale;
    // The design point under the pointer, which is what must not move.
    const held = {
      x: (300 - store.editor.view.tx) / before,
      y: -(200 - store.editor.view.ty) / before,
    };

    act(() => {
      fireEvent.wheel(canvas, { deltaY: -120, ctrlKey: true, clientX: 300, clientY: 200 });
    });

    const after = store.editor.view;
    expect(after.scale).toBeGreaterThan(before);
    expect(toScreen(after, held).x).toBeCloseTo(300, 6);
    expect(toScreen(after, held).y).toBeCloseTo(200, 6);
  });
});

describe("the Tunni point", () => {
  it("is dragged, and both handles follow it", () => {
    // The round glyph, because a Tunni point only exists where there is a curve
    // to have one. Its outer contour is an ellipse of four curves.
    const store = storeOn("o");
    render(<GlyphCanvas onContextMenu={() => undefined} />, store);
    const canvas = theCanvas();

    // Hovering the curve is what puts its Tunni control on the canvas — the
    // ensemble wakes on proximity, and nothing has to be selected first.
    act(() => {
      fireEvent.pointerMove(canvas, at(store, 470, 434));
    });
    expect(store.editor.hoveredSegment).not.toBeNull();

    const before = scalesOf(store);
    const point = tunniOf(store);
    expect(point).not.toBeNull();

    // Outwards along the diagonal, which is the direction that lengthens both
    // handles: the Tunni point is where they would meet, so pushing it away
    // pushes them out together.
    drag(
      canvas,
      store,
      [point?.x ?? 0, point?.y ?? 0],
      [(point?.x ?? 0) + 20, (point?.y ?? 0) + 20],
      [(point?.x ?? 0) + 40, (point?.y ?? 0) + 40],
    );

    const after = scalesOf(store);
    expect(after?.lambda1).toBeGreaterThan(before?.lambda1 ?? 0);
    expect(after?.lambda2).toBeGreaterThan(before?.lambda2 ?? 0);
  });
});

describe("the letters either side", () => {
  it("opens a neighbour when one is double-clicked", () => {
    // The strip is "hello" and this is its first letter, so the glyph after it
    // is the `e` — drawn beyond this one's advance of 300, where nothing this
    // glyph owns can claim the click.
    const store = storeOn("h");
    render(<GlyphCanvas onContextMenu={() => undefined} />, store);
    const canvas = theCanvas();

    act(() => {
      fireEvent.doubleClick(canvas, at(store, 500, 250));
    });

    expect(store.editor.currentGlyph).toBe("e");
  });
});

describe("the context menu", () => {
  it("selects what the right-click landed on, and says what it was", () => {
    const store = storeOn();
    // In a holder rather than a bare variable: what the callback writes is what
    // the assertion reads, and a `let` written only inside a closure is a type
    // the compiler narrows to `null` and an assertion nobody can follow.
    const asked: { request: MenuRequest | null } = { request: null };
    render(
      <GlyphCanvas
        onContextMenu={(request) => {
          asked.request = request;
        }}
      />,
      store,
    );

    act(() => {
      fireEvent.contextMenu(theCanvas(), at(store, 100, 0));
    });

    expect(store.editor.selection).toHaveLength(1);
    expect(asked.request?.target?.kind).toBe("node");
  });
});

/**
 * The two pieces of a canvas jsdom does not have.
 *
 * A context, because the surface refuses to exist without one — every drawing
 * call goes into the void, which is right: what is being tested is what the
 * pointer does to the font, and the picture is tested in the render package.
 * And a size, because an element in jsdom is zero by zero, and a canvas with no
 * size has no coordinates to click at.
 */
function installCanvasStubs(): void {
  if (typeof HTMLCanvasElement === "undefined") return;

  const canvas = HTMLCanvasElement.prototype as unknown as Record<string, unknown>;
  canvas["getContext"] = function (): unknown {
    return fakeContext();
  };
  canvas["getBoundingClientRect"] = function (): Omit<DOMRect, never> {
    return {
      x: 0,
      y: 0,
      width: WIDTH,
      height: HEIGHT,
      top: 0,
      left: 0,
      right: WIDTH,
      bottom: HEIGHT,
      toJSON: () => ({}),
    };
  };
}

const WIDTH = 800;
const HEIGHT = 600;

/** A context that accepts everything and remembers nothing. */
function fakeContext(): unknown {
  const held: Record<string, unknown> = {
    measureText: () => ({ width: 0 }),
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    createLinearGradient: () => ({ addColorStop: () => undefined }),
    createPattern: () => null,
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    canvas: null,
  };

  return new Proxy(held, {
    get: (target, key) => (key in target ? target[key as string] : () => undefined),
    set: (target, key, value) => {
      target[key as string] = value;
      return true;
    },
  });
}
