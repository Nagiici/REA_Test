import * as THREE from 'three';

/** Visual adapter only. Native stumble state owns 10/30 distance and .7/1.5s
 * approach/retreat. Opacity, lane following, character fit and the post-crash
 * run-to-grab transition below are browser presentation, not recovered AI. */
export function createChaserPresentation(actors) {
  const object = new THREE.Group(); object.name = 'ClassicChasers';
  const materials = [];
  for (const actor of Object.values(actors)) {
    object.add(actor.object);
    actor.object.traverse(node => {
      if (!node.isMesh) return;
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        material.transparent = true; materials.push(material);
      }
    });
  }
  let previousState = null, crashElapsed = 0, crashStart = 30;
  object.visible = false;
  return { object, update(state, dt) {
    if (state !== previousState) { previousState = state; crashElapsed = 0; crashStart = 30; object.position.x = state.player.x; }
    const frozen = state.phase === 'paused', effectivePhase = frozen ? state.pausedFrom : state.phase;
    const crashed = effectivePhase === 'gameover';
    if (!crashed) { crashElapsed = 0; crashStart = state.stumble.guardDistanceNative; }
    else if (!frozen) crashElapsed += dt;
    const distance = crashed ? THREE.MathUtils.lerp(crashStart, 10, THREE.MathUtils.smoothstep(crashElapsed, 0, .7)) : state.stumble.guardDistanceNative;
    const opacity = THREE.MathUtils.clamp((30 - distance) / 12, 0, 1);
    object.visible = effectivePhase !== 'ready' && !state.flight && opacity > .001;
    for (const material of materials) { material.opacity = opacity; material.depthWrite = opacity > .95; }
    if (!frozen) {
      object.position.x = THREE.MathUtils.damp(object.position.x, state.player.x, 9, dt);
      object.position.y = Math.max(0, state.player.y);
      object.position.z = distance * .1;
      for (const [name, actor] of Object.entries(actors)) {
        actor.setAnimation(crashed && crashElapsed >= .7 && name === 'guard' ? 'catchup_1' : 'run');
        if (object.visible && (!crashed || name === 'guard' || crashElapsed < .7)) actor.mixer.update(dt);
      }
    }
  } };
}
