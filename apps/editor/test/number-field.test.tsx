// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { installBrowserGlobals } from "./browser-globals.js";
import { installDomStubs, render } from "./render.js";

installBrowserGlobals();

const { NumberField } = await import("../src/components/NumberField.js");

/**
 * A box holding a number, which is not the same thing as a number.
 *
 * What is asked here is the half-typed states: an empty box on the way to a new
 * value, a lone minus on the way to a negative, a trailing point on the way to a
 * fraction. Each used to be read as a number and written to the font — or read
 * as nothing and wiped by the next render — which is what made a field you
 * could nudge but not type in.
 */

beforeAll(() => {
  installDomStubs();
});

afterEach(() => {
  cleanup();
});

/**
 * A field on a value, and the last thing it committed.
 *
 * The value is held in state and moved by what the field commits, because that
 * is what the field is talking to: a box whose model never answered would be a
 * box being tested against a wall. `again` is the other way the number moves —
 * an undo, a drag on the canvas — which the box has to follow.
 */
function field(props: Partial<Parameters<typeof NumberField>[0]> = {}) {
  const onCommit = vi.fn<(next: number) => void>();
  let moveTo: ((value: number | null) => void) | null = null;

  function Holder(): React.JSX.Element {
    const [value, setValue] = useState<number | null>(props.value === undefined ? 40 : props.value);
    moveTo = setValue;
    return (
      <NumberField
        {...props}
        value={value}
        label="Left sidebearing"
        onCommit={(next) => {
          onCommit(next);
          setValue(next);
        }}
      />
    );
  }

  render(<Holder />);
  const box = screen.getByLabelText<HTMLInputElement>("Left sidebearing");
  return {
    onCommit,
    box,
    // Focused first, as typing in a box always is: the field holds a
    // half-typed number only while somebody is in it.
    type: (text: string) => {
      fireEvent.focus(box);
      fireEvent.change(box, { target: { value: text } });
    },
    again: (value: number | null) => act(() => moveTo?.(value)),
  };
}

describe("typing a number", () => {
  it("shows what the model holds", () => {
    expect(field().box.value).toBe("40");
  });

  it("can be emptied, and writes nothing while it is empty", () => {
    // The complaint this answers: clearing the box read as zero, wrote zero,
    // and filled the box with the zero it had just written.
    const { box, type, onCommit } = field();
    type("");

    expect(box.value).toBe("");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("holds a minus on its way to a negative", () => {
    const { box, type, onCommit } = field();
    type("-");
    expect(box.value).toBe("-");
    expect(onCommit).not.toHaveBeenCalled();

    type("-1");
    expect(onCommit).toHaveBeenLastCalledWith(-1);
    type("-12");
    expect(onCommit).toHaveBeenLastCalledWith(-12);
  });

  it("holds a trailing point on its way to a fraction", () => {
    const { box, type, onCommit } = field();
    type("12.");
    expect(box.value).toBe("12.");
    expect(onCommit).toHaveBeenLastCalledWith(12);
  });

  it("writes each number as it is typed, since the canvas is showing it", () => {
    const { type, onCommit } = field();
    type("4");
    type("45");
    expect(onCommit.mock.calls).toEqual([[4], [45]]);
  });

  it("keeps what was typed when the model agrees with it", () => {
    // `007` is the number the model has; rewriting the box would be arguing.
    const { box, type, again } = field();
    type("007");
    again(7);
    expect(box.value).toBe("007");
  });

  it("follows the model when it moves on its own", () => {
    // An undo, or a drag on the canvas: the box is showing a number, and the
    // number changed.
    const { box, again } = field();
    again(120);
    expect(box.value).toBe("120");
  });

  it("settles to the model's own spelling when it is left", () => {
    const { box, type, again } = field();
    type("");
    fireEvent.blur(box);
    expect(box.value).toBe("40");

    type("0040");
    again(40);
    fireEvent.blur(box);
    expect(box.value).toBe("40");
  });

  it("puts the box back on Escape", () => {
    const { box, type } = field();
    fireEvent.focus(box);
    type("-");
    fireEvent.keyDown(box, { key: "Escape" });
    expect(box.value).toBe("40");
  });

  it("shows nothing for a value the model has not got", () => {
    expect(field({ value: null }).box.value).toBe("");
  });

  it("fills in as soon as the model has a number to show", () => {
    // The bug this answers: a new glyph has no sidebearings until something is
    // drawn in it, and the boxes stayed empty after it was — an empty box is
    // not a number, and "not a number" was being read as "somebody is typing".
    const { box, again } = field({ value: null });
    expect(box.value).toBe("");

    again(40);
    expect(box.value).toBe("40");
  });

  it("does not fill in under the cursor of somebody typing in it", () => {
    // The other half of the same rule: while the box has the focus, what is in
    // it belongs to the person, however little of a number it is so far.
    const { box, type, again } = field();
    type("");
    again(120);
    expect(box.value).toBe("");

    fireEvent.blur(box);
    expect(box.value).toBe("120");
  });
});

describe("the arrow keys", () => {
  it("step by one, and by ten with shift", () => {
    // Each from where the last one left the number, since the model follows.
    const { box, onCommit } = field();
    fireEvent.keyDown(box, { key: "ArrowUp" });
    expect(onCommit).toHaveBeenLastCalledWith(41);

    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(onCommit).toHaveBeenLastCalledWith(40);

    fireEvent.keyDown(box, { key: "ArrowUp", shiftKey: true });
    expect(onCommit).toHaveBeenLastCalledWith(50);
    expect(box.value).toBe("50");
  });

  it("keep to the bounds the field was given", () => {
    const { box, onCommit } = field({ value: 0, bounds: { min: 0 } });
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(onCommit).toHaveBeenLastCalledWith(0);
  });

  it("step by what the field says, where that is not one", () => {
    const { box, onCommit } = field({ value: 1, step: 0.01 });
    fireEvent.keyDown(box, { key: "ArrowUp" });
    expect(onCommit).toHaveBeenLastCalledWith(1.01);
  });

  it("have nothing to step from where there is no value", () => {
    const { box, onCommit } = field({ value: null });
    fireEvent.keyDown(box, { key: "ArrowUp" });
    expect(onCommit).not.toHaveBeenCalled();
  });
});
