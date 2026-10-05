/**
 * The export worker: a font compiled off the page's own thread.
 *
 * Asked for one export, it says how far it has got as it goes, and then what it
 * made or that it could not. One export to a worker: the page starts one for
 * each and ends it afterwards, so nothing here keeps anything.
 */
import { type ExportReply, type ExportRequest, runExport } from "./export-jobs.js";

const reply = (message: ExportReply): void => {
  postMessage(message);
};

addEventListener("message", (event: MessageEvent<ExportRequest>) => {
  const { id, job } = event.data;
  runExport(job, (done, total) => {
    reply({ id, progress: { done, total } });
  }).then(
    (made) => {
      reply({ id, made });
    },
    (error: unknown) => {
      reply({ id, failed: error instanceof Error ? error.message : String(error) });
    },
  );
});
