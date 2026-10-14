import type { Reporter } from "vitest/node";

/** Lists the tests that passed using more than half their time limit. See `reporter.mjs`. */
export default class Durations implements Reporter {}
