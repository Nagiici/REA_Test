/**
 * Explicit source tag=Subway trigger tracking, never inferred from visual names.
 * Native fallback: Character81966 enter,81965 exit,81943 ForceLeaveSubway;
 * Jetpack82464 takeoff clears at characterY > SubwayMaxY. All units are browser
 * units, world +Z. Unity callback/contact timing is adapted to one update call.
 */

import { overlapsRunnerEntity } from './classic-contact.js';

// Camera triggers and hazards share the same source CapsuleTrigger dimensions.
export const overlapsSubwayVolume = overlapsRunnerEntity;

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
