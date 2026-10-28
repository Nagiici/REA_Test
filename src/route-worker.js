/** RouteBuilderWorker84110..84116, APK 7.07.0. Cooperative coroutines, not
 * background threads: one queue head per update, nested IEnumerator stack,
 * 2–5 ms realtime budget, mandatory completion at the ready boundary. */
export const routeWorkFactor = (distance, boundary, width) => Math.max(0, Math.min(1, 1 - (distance - boundary) / width));

export class RouteWork {
  constructor(iterator) { this.stack = [iterator]; this.done = false; this.value = undefined; this.steps = 0; }
  step() {
    if (this.done) return;
    const next = this.stack.at(-1).next(); this.steps++;
    if (next.done) {
      this.stack.pop();
      if (!this.stack.length) { this.done = true; this.value = next.value; }
    } else if (next.value?.next) this.stack.push(next.value);
  }
  finish() { while (!this.done) this.step(); return this.value; }
}

export class RouteWorker {
  constructor({ now = () => performance.now() } = {}) { this.now = now; this.reset(); }
  reset() { this.spawn = []; this.despawn = []; this.active = 'despawn'; this.lastUpdate = null; this.byChunk = new Map(); }
  enqueue(kind, chunk, iterator, complete = () => {}) {
    const previous = this.byChunk.get(chunk);
    if (previous) { previous.work.finish(); this.complete(previous); }
    const job = { kind, chunk, work: new RouteWork(iterator), complete, notified: false };
    this.byChunk.set(chunk, job); this[kind].push(job); return job;
  }
  complete(job) {
    if (!job.notified) { job.notified = true; job.complete(job.work.value); }
    if (this.byChunk.get(job.chunk) === job) this.byChunk.delete(job.chunk);
  }
  update(playerDistance) {
    // SwitchActiveWorkQueue: alternate with cleanup when present. An empty
    // cleanup queue must never stall ordinary spawn work for a spare frame.
    this.active = this.active === 'despawn' || !this.despawn.length ? 'spawn' : 'despawn';
    const job = this[this.active][0];
    if (!job) { this.lastUpdate = null; return; }
    const factor = job.kind === 'spawn'
      ? routeWorkFactor(job.chunk.startDistance, playerDistance + 80, 10)
      : routeWorkFactor(job.chunk.endDistance, playerDistance - 50, 183);
    const budgetMs = Math.fround(.002 + factor * .003) * 1000;
    const start = this.now(), previousSteps = job.work.steps;
    if (factor === 1) job.work.finish();
    else do { job.work.step(); } while (!job.work.done && this.now() - start < budgetMs);
    this.lastUpdate = { kind: job.kind, chunkId: job.chunk.id, factor, budgetMs,
      steps: job.work.steps - previousSteps, completed: job.work.done };
    if (job.work.done) { this[this.active].shift(); this.complete(job); }
  }
}
