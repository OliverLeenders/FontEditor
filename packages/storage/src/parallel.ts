/**
 * Running many small file operations without doing them one at a time.
 *
 * A font is thousands of files, and every one of them is a round trip: open a
 * handle, read or write, close. Awaited in a loop that is thousands of round
 * trips end to end, and the thread spends nearly all of it waiting. Started a
 * few at a time it is the same work with the waiting overlapped.
 *
 * A few, not all: opening ten thousand file handles at once is how a browser is
 * asked to run out of them, and the gain is flat long before that.
 */

/** How many file operations are allowed to be in flight at once. */
export const AT_ONCE = 16;

/**
 * Run `job` over every item, at most `limit` at a time, results in order.
 *
 * In order because the callers depend on it: which glyph won a name collision
 * and which problem is reported first should not depend on which read happened
 * to finish first. A job that throws rejects the whole call, the same as an
 * awaited loop would — the callers that tolerate a bad file catch it inside the
 * job, where they know what a failure means.
 */
export async function inParallel<T, R>(
  items: readonly T[],
  job: (item: T, index: number) => Promise<R>,
  limit = AT_ONCE,
): Promise<R[]> {
  if (items.length <= 1 || limit <= 1) {
    const out: R[] = [];
    for (const [i, item] of items.entries()) out.push(await job(item, i));
    return out;
  }

  const results = new Array<R>(items.length);
  let next = 0;

  // One worker per slot, each taking the next item until there are none. Simpler
  // than batching in fixed chunks, and it does not leave the last few operations
  // waiting on the slowest member of a batch.
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await job(items[i]!, i);
    }
  });

  await Promise.all(workers);
  return results;
}
