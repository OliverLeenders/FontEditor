// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { installBrowserGlobals } from "./browser-globals.js";
import { installDomStubs, render } from "./render.js";

installBrowserGlobals();

const { Stepper } = await import("../src/components/Stepper.js");

/**
 * The up and down beside a number field.
 *
 * The arithmetic is `stepping.ts` and is tested there; what is asked here is
 * what the buttons do with it — that a single press steps once and immediately,
 * that holding one repeats and letting go stops, that shift steps by ten, and
 * that an arrow which would do nothing is dead rather than silent.
 */

beforeAll(() => {
  installDomStubs();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** A stepper on a value, with the field it wraps. */
function stepper(props: Partial<Parameters<typeof Stepper>[0]> = {}) {
  const onStep = vi.fn<(next: number) => void>();
  render(
    <Stepper value={10} label="Advance" onStep={onStep} {...props}>
      <input aria-label="Advance" readOnly value={String(props.value ?? 10)} />
    </Stepper>,
  );
  return {
    onStep,
    up: screen.getByRole("button", { name: "Increase Advance" }),
    down: screen.getByRole("button", { name: "Decrease Advance" }),
  };
}

/** Time passing, with whatever it sets off rendered before the next line runs. */
function after(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

/**
 * A press with shift held.
 *
 * jsdom has no `PointerEvent`, so the modifiers of one built by `fireEvent` are
 * dropped; a mouse event of the same name carries them and React reads it the
 * same way.
 */
function pressWithShift(button: HTMLElement): void {
  fireEvent(button, new MouseEvent("pointerdown", { bubbles: true, shiftKey: true }));
}

describe("stepping a number field", () => {
  it("steps once on a press, without waiting for the hold", () => {
    const { onStep, up } = stepper();
    fireEvent.pointerDown(up);
    expect(onStep).toHaveBeenCalledWith(11);
    expect(onStep).toHaveBeenCalledTimes(1);
  });

  it("steps down as well", () => {
    const { onStep, down } = stepper();
    fireEvent.pointerDown(down);
    expect(onStep).toHaveBeenCalledWith(9);
  });

  // Stepping lands on multiples of the step rather than adding to what is
  // there, which is `stepping.ts`'s doing and is why 10 by fifty is 50.
  it("takes the step it is given, and ten of them with shift", () => {
    const { onStep, up } = stepper({ step: 5 });
    fireEvent.pointerDown(up);
    expect(onStep).toHaveBeenCalledWith(15);

    pressWithShift(up);
    expect(onStep).toHaveBeenLastCalledWith(50);
  });

  it("takes a big step of its own where one is given", () => {
    const { onStep, up } = stepper({ bigStep: 100 });
    pressWithShift(up);
    expect(onStep).toHaveBeenCalledWith(100);
  });

  it("keeps the focus on the field rather than taking it to the arrow", () => {
    const { up } = stepper();
    // `false` is an event whose default was stopped, which is what keeps the
    // caret where somebody was typing.
    expect(fireEvent.pointerDown(up)).toBe(false);
  });

  it("repeats while the button is held, and stops when it is let go", () => {
    vi.useFakeTimers();
    const { onStep, up } = stepper();

    fireEvent.pointerDown(up);
    expect(onStep).toHaveBeenCalledTimes(1);

    // Nothing happens during the wait that tells a press from a hold.
    after(390);
    expect(onStep).toHaveBeenCalledTimes(1);

    after(10 + 60 * 3);
    expect(onStep.mock.calls.length).toBeGreaterThan(3);
    expect(onStep).toHaveBeenLastCalledWith(14);

    const held = onStep.mock.calls.length;
    fireEvent.pointerUp(up);
    after(600);
    expect(onStep).toHaveBeenCalledTimes(held);
  });

  it("stops repeating when the pointer leaves the button", () => {
    vi.useFakeTimers();
    const { onStep, up } = stepper();

    fireEvent.pointerDown(up);
    fireEvent.pointerLeave(up);
    after(1000);

    expect(onStep).toHaveBeenCalledTimes(1);
  });

  it("stops at a bound rather than repeating against it", () => {
    vi.useFakeTimers();
    const { onStep, up } = stepper({ bounds: { max: 12 } });

    fireEvent.pointerDown(up);
    after(400 + 60 * 20);

    expect(onStep).toHaveBeenLastCalledWith(12);
  });
});

describe("an arrow with nothing to do", () => {
  it("is dead at the bound it would step past", () => {
    const { up, down } = stepper({ value: 10, bounds: { max: 10 } });
    expect(up.hasAttribute("disabled")).toBe(true);
    expect(down.hasAttribute("disabled")).toBe(false);
  });

  it("is dead where there is no value to step", () => {
    const { onStep, up } = stepper({ value: null });
    expect(up.hasAttribute("disabled")).toBe(true);
    fireEvent.pointerDown(up);
    expect(onStep).not.toHaveBeenCalled();
  });

  it("is dead while the whole field is", () => {
    const { onStep, up } = stepper({ disabled: true });
    expect(up.hasAttribute("disabled")).toBe(true);
    fireEvent.pointerDown(up);
    expect(onStep).not.toHaveBeenCalled();
  });
});
