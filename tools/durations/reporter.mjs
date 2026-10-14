/**
 * Tests that pass, and took more than half the time they are allowed.
 *
 * A test that times out on a busy machine and passes on the next run says
 * nothing about the code, and twice it cost a red CI run for exactly that: a
 * stroke compared with the pen swept along it took three seconds of its five on
 * an idle machine and fifteen on a loaded one. Nothing said it was close until
 * it was over. This says so while there is still room: every test that passed
 * using more than half of its limit is listed at the end of the run, with how
 * long it took and of how long, and on GitHub as a warning beside the test.
 *
 * It fails nothing. What to do about a test on the list is a judgement — give
 * it a limit of its own, make it cheaper, or make the code faster — and the
 * list is where that starts.
 *
 * Given to each package's tests in its `vitest.config.ts`, beside the default
 * reporter.
 */

/** The share of its limit past which a test is said to be close to it. */
const CLOSE = 0.5;

const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`;

export default class Durations {
  /** @type {number} */
  limit = 5000;
  /** @type {{ name: string; file: string; took: number; allowed: number }[]} */
  close = [];

  /** @param {{ config: { testTimeout: number } }} vitest */
  onInit(vitest) {
    this.limit = vitest.config.testTimeout;
    this.close = [];
  }

  /**
   * @param {{
   *   fullName: string;
   *   module: { moduleId: string; relativeModuleId?: string };
   *   options: { timeout: number | undefined };
   *   result: () => { state: string };
   *   diagnostic: () => { duration: number } | undefined;
   * }} test
   */
  onTestCaseResult(test) {
    if (test.result().state !== "passed") return;
    const took = test.diagnostic()?.duration ?? 0;
    const allowed = test.options.timeout ?? this.limit;
    // No limit at all is a limit of nothing to be close to.
    if (allowed <= 0 || took <= allowed * CLOSE) return;
    this.close.push({
      name: test.fullName,
      file: test.module.relativeModuleId ?? test.module.moduleId,
      took,
      allowed,
    });
  }

  onTestRunEnd() {
    if (this.close.length === 0) return;
    const nearest = [...this.close].sort((a, b) => b.took / b.allowed - a.took / a.allowed);
    const lines = nearest.map(
      (t) =>
        `  ${String(Math.round((t.took / t.allowed) * 100))}%  ${seconds(t.took)} of ${seconds(t.allowed)}  ${t.file} > ${t.name}`,
    );
    process.stdout.write(
      `\n${String(nearest.length)} test${nearest.length === 1 ? "" : "s"} passed using more than half the time allowed:\n${lines.join("\n")}\n`,
    );
    if (process.env.GITHUB_ACTIONS === "true") {
      for (const t of nearest) {
        const said = `${t.name}: ${seconds(t.took)} of the ${seconds(t.allowed)} it is allowed`;
        process.stdout.write(`::warning file=${t.file},title=Close to its time limit::${said}\n`);
      }
    }
  }
}
