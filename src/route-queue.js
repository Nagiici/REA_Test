import { RouteWorker } from './route-worker.js';
/** Ordinary DefaultRouteBuilder queue (APK 7.07.0).
 * Spawn chooses chunk prefabs; Build performs selectors/activation later.
 * Update83932: one spawn per update, BuildChunks83935: start < playerZ+900.
 * CurrentDistanceToChunksSpawned83931 retains its menu default 2000 in a
 * normal run; 500 is the tutorial-loading reset, not the ordinary run value.
 * Normal build enqueues cooperative content work. IsBuilt is a scheduling
 * flag; ready/readyEdge describe completed content, not the built cursor.
 */
export const CLASSIC_ROUTE_QUEUE = Object.freeze({ spawnAhead: 200, buildAhead: 90, despawnBehind: 17 });
const EPS = 1e-7;

export class ClassicRouteQueue {
  constructor(source, decorate = chunk => chunk, workerOptions = {}) {
    this.source = source; this.decorate = decorate; this.worker = new RouteWorker(workerOptions); this.reset();
  }
  reset() {
    this.spawnedEdge = this.builtEdge = this.readyEdge = this.source.initialDistance;
    this.worker.reset(); this.completed = []; this.context = null;
    this.chunks = []; this.sections = []; this.directives = []; this.events = [];
    this.nextId = 0;
  }
  get minimumJetpackLandingZ() {
    const last = this.sections.at(-1)?.section;
    return last ? last.startDistance + last.fields._lengthMin * this.source.unitScale : 0;
  }
  get pendingJetpackLanding() { return this.directives[0] ?? null; }

  enqueueJetpackLanding(target) {
    if (!Number.isFinite(target) || target < 0) throw new Error('Invalid Jetpack landing position');
    const grid = 180 * this.source.unitScale;
    if (Math.abs(target / grid - Math.round(target / grid)) > EPS) return this.reject(target, 'off-grid');
    if (this.directives.length && target < this.directives.at(-1).target) return this.reject(target, 'out-of-order');
    // EnqueueBuildDirective83923: roll back whole trailing sections ONLY if
    // their first spawned chunk is unbuilt and minimum end exceeds target.
    while (this.sections.length && this.minimumJetpackLandingZ > target + EPS) {
      const last = this.sections.at(-1);
      if (last.firstBuilt) break;
      this.chunks = this.chunks.filter(chunk => chunk.sectionRecord !== last);
      this.spawnedEdge = last.startDistance;
      this.sections.pop();
      if (this.source.forcedLandingSection?.section === last.section) this.source.forcedLandingSection = null;
      this.events.push({ type: 'rollback-unbuilt-section', sectionId: last.section.id, startDistance: last.startDistance });
    }
    this.source.currentSection = this.sections.at(-1)?.section ?? null;
    // No RNG rewind, repeat-cooldown refund or SectionCountUsed decrement.
    if (target < this.minimumJetpackLandingZ - EPS || target < this.builtEdge - EPS)
      return this.reject(target, 'built-section-boundary');
    const request = { requestedTarget: target, target, leadingEdgeAtRequest: this.spawnedEdge,
      currentSectionMinimum: this.minimumJetpackLandingZ,
      strict: true, sectionSpawnMode: 'All', chunkBuildMode: 'Normal', adapter: 'source-build-directive' };
    this.directives.push(request);
    this.source.pendingJetpackLanding = this.pendingJetpackLanding;
    this.events.push({ type: 'enqueue-landing', target });
    return { accepted: true, target };
  }
  reject(target, reason) {
    this.events.push({ type: 'reject-landing', target, reason });
    return { accepted: false, target, reason };
  }

  update(context, { prime = false } = {}) {
    const emitted = []; this.context = context;
    // Menu/loading runs this update repeatedly before input is available.
    do {
      while (this.pendingJetpackLanding && this.pendingJetpackLanding.target < this.spawnedEdge - EPS) {
        this.events.push({ type: 'missed-strict-landing', target: this.directives.shift().target });
      }
      this.source.pendingJetpackLanding = this.pendingJetpackLanding;
      // ProcessBuildDirectives precedes the spawn-horizon test. AddSection
      // consumes Reset RNG now, even if its first chunk must wait to spawn.
      if (this.pendingJetpackLanding && Math.abs(this.pendingJetpackLanding.target - this.spawnedEdge) < EPS) {
        this.source.prepareJetpackLandingSection({ ...context, startDistance: this.spawnedEdge });
        this.registerSection(this.source.currentSection, this.spawnedEdge);
      }
      if (this.spawnedEdge < context.playerDistance + CLASSIC_ROUTE_QUEUE.spawnAhead) {
        const startDistance = this.spawnedEdge;
        const plan = this.source.nextChunk({ ...context, startDistance, deferBuild: true });
        const record = this.registerSection(plan.section, startDistance);
        this.chunks.push({ id: this.nextId++, plan, startDistance, endDistance: startDistance + plan.length,
          built: false, sectionRecord: record });
        this.spawnedEdge += plan.length;
        if (plan.provenance.jetpackLanding?.kind === 'landing') {
          this.directives.shift(); this.source.pendingJetpackLanding = this.pendingJetpackLanding;
          this.events.push({ type: 'spawn-landing', startDistance });
        }
      }
      for (const chunk of this.chunks) {
        if (chunk.built) continue;
        if (chunk.startDistance >= context.playerDistance + CLASSIC_ROUTE_QUEUE.buildAhead) break;
        // RouteChunk.Build sets IsBuilt before the coroutine performs selectors.
        chunk.built = true; chunk.ready = false;
        if (chunk.id === chunk.sectionRecord.firstId) chunk.sectionRecord.firstBuilt = true;
        this.builtEdge = chunk.endDistance;
        const builtAtPlayerDistance = context.playerDistance;
        this.worker.enqueue('spawn', chunk,
          this.source.buildPreparedChunkWork(chunk.plan, () => this.context), built => {
            built.provenance.queue = { id: chunk.id, startDistance: chunk.startDistance,
              builtAtPlayerDistance, readyAtPlayerDistance: this.context.playerDistance, mode: 'Normal' };
            chunk.ready = true; this.readyEdge = chunk.endDistance;
            this.completed.push(this.decorate(built, { ...this.context, startDistance: chunk.startDistance }));
          });
      }

      while (this.chunks[0]?.built && this.chunks[0].endDistance + CLASSIC_ROUTE_QUEUE.despawnBehind < context.playerDistance) {
        const chunk = this.chunks.shift();
        // Browser meshes/entities have their own distance-based lifetime; this
        // coroutine releases the queue descriptor (there are no Unity pools).
        this.worker.enqueue('despawn', chunk, (function* () { chunk.plan = null; yield; })());
      }
      const active = new Set(this.chunks.map(chunk => chunk.sectionRecord));
      this.sections = this.sections.filter((section, i) => active.has(section) || i === this.sections.length - 1);
      this.worker.update(context.playerDistance);
      emitted.push(...this.completed.splice(0));
    } while (prime && this.spawnedEdge < context.playerDistance + CLASSIC_ROUTE_QUEUE.spawnAhead);
    // Bounded diagnostics; source queue itself retains only live chunks.
    if (this.events.length > 128) this.events.splice(0, this.events.length - 128);
    return emitted;
  }

  registerSection(section, startDistance) {
    let record = this.sections.at(-1);
    if (record?.section !== section) {
      record = { section, startDistance, firstBuilt: false, firstId: this.nextId };
      this.sections.push(record);
    }
    return record;
  }
}
