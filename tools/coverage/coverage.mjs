/**
 * How much of the source the tests run, package by package and in all.
 *
 * Every package has its own tests and is tested on its own, so each is
 * measured on its own: its tests run with coverage on, and what they say of
 * the package's `src/` is read from the summary each leaves. What a package's
 * tests happen to run of *another* package is not counted for it — a line of
 * the model that only the editor's tests reach is a line the model's own tests
 * do not, and that is the number worth having.
 *
 *   node tools/coverage/coverage.mjs                  measure, and print a table
 *   node tools/coverage/coverage.mjs --check          …and fail under the floors
 *   node tools/coverage/coverage.mjs packages/view    only these
 *   node tools/coverage/coverage.mjs --list           the packages there are, as JSON
 *
 * Counting every line makes a package's tests several times as slow, and the
 * packages that draw strokes and compile fonts are an hour each of it. So at
 * night each package is measured in a job of its own, side by side, from the
 * list `--list` gives.
 *
 * In CI the table is written to the job's summary as well. The floors are in
 * `floors.json` beside this, a number for each package: what it measured when
 * the floor was set, less a point, so that a change which leaves a package
 * less tested than it was is noticed, and one that adds tests can raise it.
 *
 * The slow checks a variable asks for (`STROKE_DIAGNOSE`, a longer
 * `WALK_SEEDS`) are left off: this measures what every push runs.
 */

import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const check = args.includes("--check");
const asked = args.filter((arg) => !arg.startsWith("--")).map((arg) => arg.replace(/\\/g, "/"));

/** Every package with tests of its own, as a path from the root. */
function packages() {
  const found = [];
  for (const group of ["packages", "apps"]) {
    for (const name of readdirSync(join(root, group))) {
      const path = `${group}/${name}`;
      if (existsSync(join(root, path, "vitest.config.ts"))) found.push(path);
    }
  }
  return asked.length === 0 ? found : found.filter((path) => asked.includes(path));
}

/** Run one package's tests with coverage on, and read what they covered of its source. */
function measure(path) {
  const cwd = join(root, path);
  const out = join(cwd, "coverage");
  rmSync(out, { recursive: true, force: true });

  const run = spawnSync(
    "pnpm",
    [
      "exec",
      "vitest",
      "run",
      "--coverage",
      "--coverage.provider=v8",
      "--coverage.reporter=json-summary",
      "--coverage.include=src/**",
      // Counting every line makes the heavy tests several times as slow — a
      // font compiled, a pen swept along a path — and a test that runs out of
      // time while it is being counted has not found anything. So each is given
      // ten minutes where the package gives no time of its own, and what was
      // run is reported whether or not every test got to its end: this is a
      // measurement, and `pnpm test` is what says whether they pass.
      "--testTimeout=600000",
      "--coverage.reportOnFailure=true",
      // Data and declarations: nothing in them is run, or all of it is.
      "--coverage.exclude=src/**/*.d.ts",
      "--coverage.exclude=src/**/*-data.ts",
    ],
    {
      cwd,
      shell: true,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      // Plain words, since what it says is read below.
      env: { ...process.env, NO_COLOR: "1" },
    },
  );
  const summary = join(out, "coverage-summary.json");
  const said = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  if (!existsSync(summary)) {
    process.stderr.write(`${path}: nothing was measured\n`);
    process.stderr.write(said.split("\n").slice(-25).join("\n"));
    return null;
  }
  if (run.status !== 0) {
    // Said, and not held against it: see the timeouts above.
    const lost = /Tests\s+(\d+) failed/.exec(said)?.[1] ?? "some";
    process.stderr.write(`${path}: ${lost} of its tests did not finish while being counted\n`);
  }
  const { total } = JSON.parse(readFileSync(summary, "utf8"));
  return { path, lines: total.lines, branches: total.branches, functions: total.functions };
}

if (args.includes("--list")) {
  process.stdout.write(`${JSON.stringify(packages())}\n`);
  process.exit(0);
}

const percent = (part) => (part.total === 0 ? 100 : (part.covered / part.total) * 100);
const shown = (value) => `${value.toFixed(1)}%`;

const measured = [];
let failed = false;
for (const path of packages()) {
  process.stderr.write(`measuring ${path}…\n`);
  const one = measure(path);
  if (one === null) failed = true;
  else measured.push(one);
}

const sum = (key) => ({
  covered: measured.reduce((n, one) => n + one[key].covered, 0),
  total: measured.reduce((n, one) => n + one[key].total, 0),
});
const all = { path: "all", lines: sum("lines"), branches: sum("branches"), functions: sum("functions") };

const floorsPath = join(dirname(fileURLToPath(import.meta.url)), "floors.json");
const floors = existsSync(floorsPath) ? JSON.parse(readFileSync(floorsPath, "utf8")) : {};

// The sum is a line of its own only where it is of more than one thing.
const rows = (measured.length === 1 ? measured : [...measured, all]).map((one) => {
  const lines = percent(one.lines);
  const floor = floors[one.path];
  const under = floor !== undefined && lines < floor;
  return {
    name: one.path,
    lines: shown(lines),
    count: `${String(one.lines.covered)} of ${String(one.lines.total)}`,
    branches: shown(percent(one.branches)),
    functions: shown(percent(one.functions)),
    floor: floor === undefined ? "" : `${String(floor)}%${under ? " — under" : ""}`,
    under,
  };
});

const table = [
  "| Package | Lines | | Branches | Functions | Floor |",
  "| --- | ---: | ---: | ---: | ---: | ---: |",
  ...rows.map(
    (row) =>
      `| ${row.name} | ${row.lines} | ${row.count} | ${row.branches} | ${row.functions} | ${row.floor} |`,
  ),
].join("\n");

process.stdout.write(`${table}\n`);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## What the tests run of the source\n\n${table}\n`);
}

const under = rows.filter((row) => row.under);
if (check && under.length > 0) {
  process.stderr.write(
    `\nUnder its floor: ${under.map((row) => row.name).join(", ")}. See tools/coverage/floors.json.\n`,
  );
  failed = true;
}
process.exit(failed ? 1 : 0);
