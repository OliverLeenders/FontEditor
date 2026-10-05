import {
  type ExportJob,
  type ExportOutcome,
  type ExportReply,
  type ExportRequest,
  type Told,
  runExport,
} from "./export-jobs.js";

/**
 * Compile a font without the window stopping while it is done.
 *
 * In a worker, where there is one: started for this export and ended after it.
 * A worker kept would keep the exporters and a copy of the last font it was
 * sent, for the sake of the half second it takes to start another — and an
 * export is the last thing done in a session, not something done in a loop.
 *
 * On the page's own thread where there is no worker to be had, which is the
 * tests, and where one could not be started or sent the font: an export that
 * holds the window is still an export, and a failure to move it elsewhere is
 * not a reason to refuse it.
 *
 * `told` is how far it has got, for the exports that count their glyphs.
 */
export async function compile<Job extends ExportJob>(
  job: Job,
  told?: Told,
): Promise<ExportOutcome<Job>> {
  if (typeof Worker === "undefined") return await runExport(job, told);

  let worker: Worker;
  try {
    worker = new Worker(new URL("./export.worker.ts", import.meta.url), { type: "module" });
  } catch {
    return await runExport(job, told);
  }

  try {
    return await new Promise<ExportOutcome<Job>>((resolve, reject) => {
      const id = 1;
      worker.addEventListener("message", (event: MessageEvent<ExportReply>) => {
        const said = event.data;
        if (said.id !== id) return;
        if ("progress" in said) told?.(said.progress.done, said.progress.total);
        else if ("failed" in said) reject(new Error(said.failed));
        else resolve(said.made as ExportOutcome<Job>);
      });
      // The worker itself failing: its script not there, or thrown out of.
      worker.addEventListener("error", (event) => {
        reject(new NoWorker(event.message));
      });
      worker.addEventListener("messageerror", () => {
        reject(new NoWorker("the export could not be read back"));
      });
      try {
        worker.postMessage({ id, job } satisfies ExportRequest);
      } catch (error) {
        // Something in the font that cannot be copied to another thread.
        reject(new NoWorker(error instanceof Error ? error.message : String(error)));
      }
    });
  } catch (error) {
    if (error instanceof NoWorker) return await runExport(job, told);
    throw error;
  } finally {
    worker.terminate();
  }
}

/** The worker could not be used, as against the export having failed in it. */
class NoWorker extends Error {}
