/**
 * Explicit source tag=Subway trigger tracking, never inferred from visual names.
 * Native fallback: Character81966 enter,81965 exit,81943 ForceLeaveSubway;
 * Jetpack82464 takeoff clears at characterY > SubwayMaxY. All units are browser
 * units, world +Z. Unity callback/contact timing is adapted to one update call.
 */

function segmentBoxDistanceSquared(a, b, half) {
  const d = b.map((v, i) => v - a[i]), breaks = [0, 1];
  for (let i = 0; i < 3; i++) if (Math.abs(d[i]) > 1e-12) {
    for (const sign of [-1, 1]) {
      const t = (sign * half[i] - a[i]) / d[i];
      if (t > 0 && t < 1) breaks.push(t);
    }
  }
  breaks.sort((x, y) => x - y);
  const distanceAt = t => a.reduce((sum, v, i) => sum + Math.max(0, Math.abs(v + d[i] * t) - half[i]) ** 2, 0);
  let best = Infinity;
  for (let j = 0; j < breaks.length - 1; j++) {
    const lo = breaks[j], hi = breaks[j + 1], mid = (lo + hi) / 2;
    best = Math.min(best, distanceAt(lo), distanceAt(hi));
    let numerator = 0, denominator = 0;
    for (let i = 0; i < 3; i++) {
      const value = a[i] + d[i] * mid;
      if (Math.abs(value) <= half[i]) continue;
      numerator += d[i] * (a[i] - Math.sign(value) * half[i]);
      denominator += d[i] ** 2;
    }
    if (denominator > 0) best = Math.min(best, distanceAt(Math.max(lo, Math.min(hi, -numerator / denominator))));
  }
  return best;
}

/** Original r3,h10 CapsuleTrigger (roll h4 clamps to diameter6), scaled .1. */
export function overlapsSubwayVolume(state, entity) {
  const p = state.player, rolling = p.rollRemaining > 0;
  const y = p.y + (rolling ? .4 : .55), segment = rolling ? 0 : .2;
  const a = [p.x, y - segment, state.distance + .1], b = [p.x, y + segment, state.distance + .1];
  const shape = entity.sourceShape;
  if (shape?.type === 'box') {
    const norms = shape.rows.map(row => Math.hypot(row[0], row[1], row[2]));
    // Normalized inverse rows are box axes when the source transform has no
    // shear. The actual exported Subway trigger has identity rotation/scale.
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
      const dot = shape.rows[i].slice(0, 3).reduce((sum, v, k) => sum + v * shape.rows[j][k], 0) / norms[i] / norms[j];
      if (Math.abs(dot) > 1e-6) throw new Error('Sheared source Subway trigger is unsupported');
    }
    const local = point => shape.rows.map((row, i) =>
      (row[0] * (point[0] - entity.x) + row[1] * point[1] + row[2] * (point[2] - entity.distance) + row[3]) / norms[i]);
    return segmentBoxDistanceSquared(local(a), local(b), shape.halfSize.map((v, i) => v / norms[i])) <= .3 ** 2;
  }
  const center = [entity.x, ((entity.bottom ?? 0) + entity.height) / 2, entity.distance];
  return segmentBoxDistanceSquared(a.map((v, i) => v - center[i]), b.map((v, i) => v - center[i]),
    [entity.width / 2, (entity.height - (entity.bottom ?? 0)) / 2, entity.depth / 2]) <= .3 ** 2;
}

export class ClassicCameraVolumes {
  constructor() { this.reset(); }
  reset() {
    this.contacts = new Set(); this.active = new Set(); this.subwayMaxY = Infinity;
    this.state = null;
    return this.snapshot();
  }
  snapshot() { return { insideSubway: this.active.size > 0, subwayMaxY: this.subwayMaxY }; }

  update(state, entities) {
    if (state !== this.state) { this.reset(); this.state = state; }
    if (state.phase === 'paused' || state.phase === 'gameover') return this.snapshot();
    if (state.phase === 'ready' || state.phase === 'intro') {
      this.contacts.clear(); this.active.clear(); return this.snapshot();
    }
    // Source disables the character trigger during takeoff. Preserve outstanding
    // contacts while disabled and use the explicit ForceLeaveSubway condition.
    if (state.flight?.characterColliderEnabled !== false) {
      const contacts = new Set();
      for (const entity of entities) {
        if (entity.cameraVolume?.kind !== 'Subway' || !overlapsSubwayVolume(state, entity)) continue;
        // Runtime entity ids distinguish repeat instances of the same source.
        const key = entity.id ?? entity;
        contacts.add(key);
        if (!this.contacts.has(key)) {
          this.active.add(key);
          this.subwayMaxY = entity.cameraVolume.maxY;
        }
      }
      for (const key of this.contacts) if (!contacts.has(key)) this.active.delete(key);
      this.contacts = contacts;
    }
    if (state.flight?.takingOff && this.active.size && state.player.y > this.subwayMaxY) {
      // Clearing active does not create another Enter for a still-overlapping
      // collider; retain contacts until a real geometric exit/reentry occurs.
      this.active.clear();
    }
    return this.snapshot();
  }
}

export default ClassicCameraVolumes;

/** Legacy Tunnel24152 is a distance modifier, independent of Subway ceiling
 * limits. OnTriggerEnter captures CURRENT player Z; no OnTriggerExit exists.
 * Actual source BoxColliders are emitted by SourceRouteGenerator. */
export class ClassicTunnelModifiers {
  constructor() { this.state = null; this.contacts = new Set(); this.lastEntry = null; }
  update(state, entities, camera) {
    if (state !== this.state) {
      this.state = state; this.contacts.clear(); this.lastEntry = null; camera.exitCameraModifier();
    }
    if (state.phase === 'paused' || state.phase === 'gameover') return this.lastEntry;
    if (state.phase === 'ready' || state.phase === 'intro') {
      this.contacts.clear(); this.lastEntry = null; camera.exitCameraModifier(); return null;
    }
    if (state.flight?.characterColliderEnabled === false) return this.lastEntry;
    const contacts = new Set();
    for (const entity of entities) {
      if (entity.tunnelModifier == null || !overlapsSubwayVolume(state, entity)) continue;
      const key = entity.id ?? entity; contacts.add(key);
      if (!this.contacts.has(key)) {
        this.lastEntry = { startZ: state.distance, length: entity.tunnelModifier.length, source: entity.provenance?.collider };
        camera.enterCameraModifier(this.lastEntry);
      }
    }
    this.contacts = contacts;
    return this.lastEntry;
  }
}
