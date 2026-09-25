/**
 * Which version of the editor this is.
 *
 * Written into the build by Vite — see `__APP_VERSION__` in `vite.config.ts` —
 * out of the same manifest the release script sets, so the number on screen is
 * the number that was tagged rather than one kept in step by hand.
 *
 * A fallback for the one place it is not defined: the test runner, which loads
 * the source without Vite's `define`. Nothing in the editor depends on the
 * value, so a test that renders the preferences panel should not have to know
 * about the build at all.
 */
declare const __APP_VERSION__: string | undefined;

export const VERSION: string =
  typeof __APP_VERSION__ === "string" && __APP_VERSION__ !== "" ? __APP_VERSION__ : "0.0.0-dev";
