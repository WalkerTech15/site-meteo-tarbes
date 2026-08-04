/* "Only the newest request may finish" — a request-token race guard.
 *
 * Rapid map clicks are the motivating case: click A over the Atlantic, then
 * click B over Paris a moment later. If A's reverse geocoding is slower than
 * B's, A must not land afterwards and repaint the panel with the ocean. A
 * token taken before the first await, rechecked after every one, is what makes
 * "the last thing you clicked is what you see" true regardless of network
 * timing.
 *
 * The task receives `isStale` so it can also bail early — between two awaits —
 * instead of doing the rest of the work and having its result discarded.
 *
 * No DOM, no timers, no globals: one runner per concurrent activity. */

export function createLatestOnly() {
  let token = 0;

  /**
   * @param {(isStale: () => boolean) => Promise<any>} task
   * @returns {Promise<any|null>} the task's result, or null if superseded
   */
  async function run(task) {
    const mine = ++token;
    const isStale = () => mine !== token;
    const result = await task(isStale);
    return isStale() ? null : result;
  }

  /** How many runs have been started — useful for assertions and diagnostics. */
  run.count = () => token;
  /** Invalidate anything in flight without starting a new run. */
  run.cancel = () => {
    token++;
  };

  return run;
}
