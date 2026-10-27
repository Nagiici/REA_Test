import * as THREE from 'three';
import { geometryFromUnity } from './asset-adapter.js';
import { curveValue } from './powerups.js';
import { createSourceParticleEffect } from './source-particles.js';

/** EffectCoroutine 13381 + callback 13378: random Z rotation, source scale
 * curve, white -> black additive color, disable renderer at the deadline. */
export class PickupFlash {
  constructor(details) { this.details = details; this.reset(); }
  reset() { this.age = Infinity; this.rotation = 0; }
  play(random = Math.random) { this.age = 0; this.rotation = random() * 2 * Math.PI; }
  step(dt) { this.age += dt; return this.sample(); }
  sample() {
    const t = Math.min(1, this.age / this.details.duration);
    return { visible: t < 1, scale: curveValue(this.details.scaleCurve.keys, t), intensity: 1 - t, rotation: this.rotation };
  }
}

function sourceMeshEffect(key, pack) {
  const data = pack.classicPresentation, definition = data.effects[key];
  const object = new THREE.Group(), native = new THREE.Group(), byId = new Map(), scroll = [];
  object.name = key; object.add(native); native.scale.set(.1, .1, -.1);
  const materials = [];
  for (const source of definition.nodes) {
    const node = new THREE.Group(); node.name = source.name;
    node.position.fromArray(source.position); node.quaternion.fromArray(source.quaternion); node.scale.fromArray(source.scale);
    byId.set(source.id, node);
    if (!source.mesh) continue;
    const mats = source.materials.map(record => {
      const info = record.textures?._MainTex, map = pack.textures[info?.name]?.clone();
      if (map) { map.repeat.fromArray(info.scale); map.offset.fromArray(info.offset); map.wrapS = map.wrapT = THREE.RepeatWrapping; }
      const shader = data.materials[record.materialRef]?.shader?.name ?? '';
      const material = new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false,
        side: THREE.DoubleSide, toneMapped: false, blending: /Additive/i.test(shader) ? THREE.AdditiveBlending : THREE.NormalBlending });
      materials.push(material); return material;
    });
    node.add(new THREE.Mesh(geometryFromUnity(pack.meshData[source.mesh]), mats));
    for (const ref of source.scripts) {
      const script = data.sourceComponents[ref];
      if (script?.class?.endsWith('.JetPackCloud')) for (const material of mats) if (material.map) scroll.push({ map: material.map, ...script.fields });
    }
  }
  for (const source of definition.nodes) (byId.get(source.parentId) ?? native).add(byId.get(source.id));
  return { object, root: byId.get(definition.rootNodeId), materials, scroll };
}

/** Event bindings use the active Game scene's legacy controllers, not the
 * uninstantiated modern CharacterEffectsController. Body attachment positions,
 * Three blending and shader rendering remain browser presentation adapters. */
export function createClassicEffects(pack) {
  const data = pack.classicPresentation, object = new THREE.Group(); object.name = 'ClassicEffects';
  const pickup = Object.values(data.sourceComponents).find(x => x.class === 'CharacterPickupParticles').fields;
  const fx = Object.values(data.sourceComponents).find(x => x.class?.endsWith('.CharacterFXController')).fields;
  const flashes = Object.fromEntries([['fx_coin', pickup.coinEffect], ['fx_powerup', pickup.powerupEffect]].map(([key, details]) => {
    const mesh = sourceMeshEffect(key, pack); object.add(mesh.object); return [key, { ...mesh, timeline: new PickupFlash(details) }];
  }));
  const jetpack = sourceMeshEffect('fx_jetpack', pack); object.add(jetpack.object);
  const keys = ['fx_dust', 'fx_board_crash', 'fx_dizzy_stars', 'fx_bush_leaves', 'fx_jump_roll', 'fx_grind_sparks', 'fx_revive_camera'];
  const particles = Object.fromEntries(keys.map(key => { const effect = createSourceParticleEffect(key, pack,
    ['fx_jump_roll', 'fx_grind_sparks', 'fx_dizzy_stars', 'fx_bush_leaves'].includes(key) ? { rootPosition: [0,0,0] } : {});
    object.add(effect.object); return [key, effect]; }));
  let previousState, previousDistance = 0, clock = 0, dizzy = 0, leaves = 0, dustUntil = 0, rollingLanding = false, rollDelay = 0, grinding = false;
  const toggle = (key, value) => {
    const effect = particles[key];
    if (!!effect.active === !!value) return;
    effect.active = !!value;
    if (value) effect.play(); else effect.stop();
  };
  function reset(state) {
    previousState = state; previousDistance = state.distance; clock = dizzy = leaves = dustUntil = rollDelay = 0;
    rollingLanding = grinding = false;
    for (const effect of Object.values(particles)) { effect.reset(); effect.active = false; }
    for (const effect of Object.values(flashes)) { effect.timeline.reset(); effect.object.visible = false; }
    jetpack.object.visible = false;
  }
  const api = { object, particles, flashes, jetpack, reset, stats: {}, update(state, dt, events, camera, character = null) {
    if (state !== previousState) reset(state);
    if (state.phase === 'paused') return;
    const p = state.player, running = state.phase === 'running', distanceDelta = state.distance - previousDistance;
    previousDistance = state.distance; clock += dt;
    // Set attachment poses before Play emits a world-space burst; a previous
    // run may have ended in the air or another lane.
    for (const [key, effect] of Object.entries(particles)) {
      effect.object.position.set(p.x, p.y, 0);
      if (key === 'fx_dizzy_stars') {
        const head = character?.native.getObjectByName('Head_jnt');
        if (head) head.getWorldPosition(effect.object.position);
        else effect.object.position.y += 1.95;
        effect.object.position.y += fx._starHeightOffset * .1;
      }
      if (key === 'fx_revive_camera') { effect.object.position.copy(camera.position); effect.object.quaternion.copy(camera.quaternion); }
    }
    for (const event of events) {
      if (event.type === 'coin') flashes.fx_coin.timeline.play();
      if (event.type === 'powerup') flashes.fx_powerup.timeline.play();
      if (event.type === 'board-hit') particles.fx_board_crash.reset().play();
      if (event.type === 'revive') particles.fx_revive_camera.reset().play();
      // Browser cue adapter: native JumpAdvanced proves Stop after .5 s; the
      // preceding Play notification is not recovered (possible animation/Lua).
      if (event.type === 'jump') dustUntil = clock + .5;
      if (event.type === 'stumble') {
        if (event.animation === 'stumble_low') leaves = fx._leavesDuration;
        else if (!state.stumble.hasPendingDeath) dizzy = fx._dizzyDuration;
      }
      if (event.type === 'land') {
        if (event.rolling && !state.board.active) { rollingLanding = true; rollDelay = fx._jmupRollDespawnAddedDelay; }
        if (!event.rolling && state.board.active) grinding = true;
      }
    }
    if (!running || state.flight || state.stumble.hasPendingDeath) dizzy = 0;
    if (!running || state.board.active || state.flight) leaves = 0;
    if (rollingLanding && (!running || !p.rollRemaining || state.board.active || !p.grounded)) {
      rollDelay = Math.max(0, rollDelay - dt); if (!rollDelay) rollingLanding = false;
    }
    if (!running || !p.grounded || !state.board.active || p.rollRemaining || state.flight) grinding = false;
    toggle('fx_dizzy_stars', dizzy > 0); toggle('fx_bush_leaves', leaves > 0);
    toggle('fx_jump_roll', rollingLanding); toggle('fx_grind_sparks', grinding);
    toggle('fx_dust', clock < dustUntil && running && !state.flight);
    dizzy = Math.max(0, dizzy - dt); leaves = Math.max(0, leaves - dt);
    for (const [key, effect] of Object.entries(flashes)) {
      const sample = effect.timeline.step(dt); effect.object.visible = sample.visible;
      // Original PickupParticles child position, fitted upward to the taller replacement torso.
      effect.object.position.set(p.x, p.y + 1.05, .7);
      effect.root.scale.setScalar(sample.scale); effect.root.rotation.z = sample.rotation;
      // Face camera as the source pickup billboard component does.
      effect.object.quaternion.copy(camera.quaternion);
      for (const material of effect.materials) material.color.setScalar(sample.intensity);
    }
    jetpack.object.visible = !!state.flight;
    jetpack.object.position.set(p.x, p.y + .95, .2);
    for (const item of jetpack.scroll) item.map.offset.x = ((item.startOffset + clock * item.scrollSpeed) % 1 + 1) % 1;
    for (const effect of Object.values(particles)) effect.update(dt, { distanceDelta, camera });
    api.stats = { clock, activeParticles: Object.fromEntries(Object.entries(particles).map(([k,v]) => [k,v.aliveCount])),
      coin: flashes.fx_coin.timeline.sample(), powerup: flashes.fx_powerup.timeline.sample(), jetpack: !!state.flight };
  } };
  return api;
}
