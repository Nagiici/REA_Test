import * as THREE from 'three';
import { SourceCatchTimeline, selectCatchSequence, CLASSIC_MOTION_SOURCE } from './classic-motion.js';
import { mulberry32 } from './game-core.js';

// Infinite-maxSpeed SmoothDamp math, checked against Unity's reference source:
// https://github.com/Unity-Technologies/UnityCsReference/blob/master/Runtime/Export/Math/Mathf.cs
function smooth(current, target, velocity, time, dt) {
  if (!dt) return [current, velocity];
  const omega = 2 / Math.max(.0001, time), h = omega * dt;
  const decay = 1 / (1 + h + .48 * h * h + .235 * h * h * h);
  const change = current - target, step = (velocity + omega * change) * dt;
  const next = target + (change + step) * decay;
  return (target - current > 0) === (next > target) ? [target, 0] : [next, (velocity - omega * step) * decay];
}

/** FollowingGuard source timing/physics over the replacement actor. Opacity,
 * body fit, render-frame sampling and availability remain browser adapters. */
export function createChaserPresentation(actors, { bindings, additions, sourceActors } = {}) {
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
  const guardClips = { ...sourceActors?.guard?.animations, ...additions?.clips };
  // Single replacement uses the selected source guard's authored child anchor.
  // FollowingGuard caches this world position after placeholder initialization.
  const introAnchor = sourceActors?.guard?.rootTransform?.position ?? [0, 0, 0];
  const sourceKey = ref => Object.entries(guardClips).find(([, clip]) => `${clip.source.asset}:${clip.source.pathId}` === ref)?.[0];
  const pools = {};
  for (const side of ['caughtLeft', 'caughtRight']) pools[side] = Object.entries(bindings?.bindings ?? {})
    .filter(([key]) => key.startsWith(`${side}[`)).map(([, binding]) => ({ ...binding.sourceLink.pairedSequence,
      avatarKey: binding.key, guardKey: sourceKey(binding.sourceLink.pairedSequence.guard.ref) }));
  let previousState = null, clock = 0, crashElapsed = 0, timeline = null, selected = null;
  let xVelocity = 0, floorVelocity = 0, floor = 0, verticalSpeed = 0, queue = [], pose = null, random;
  let previousPhase = null, introGeneration = 0, introTimes = new Map();
  object.visible = false;
  const view = { object, catchAvatar: null, update(state, dt, events = []) {
    const p = state.player;
    if (state !== previousState) {
      previousState = state; clock = 0; crashElapsed = 0; timeline = selected = null; view.catchAvatar = null;
      xVelocity = floorVelocity = verticalSpeed = 0; floor = p.lastGroundedY ?? 0; queue = []; pose = null;
      previousPhase = null; introTimes = new Map();
      random = mulberry32(0x43415443); object.position.set(p.x, floor, 3);
    }
    const frozen = state.phase === 'paused', phase = frozen ? state.pausedFrom : state.phase;
    if (frozen) return;
    if (phase === 'intro') {
      if (previousPhase !== 'intro') {
        introGeneration++; introTimes = new Map(); queue = []; pose = null;
        timeline = selected = null; view.catchAvatar = null;
      }
      // PlayIntro16958 restores root (0,0,-10), then cached enemy world TRS.
      // Source root starts at that same -10, so the child anchor is preserved.
      // C=(.1,.1,-.1); the single replacement actor keeps its separate body fit.
      object.position.set(introAnchor[0] * .1, introAnchor[1] * .1, 1 - introAnchor[2] * .1); object.visible = true;
      for (const material of materials) { material.opacity = 1; material.depthWrite = true; }
      const elapsed = Math.max(0, state.intro?.elapsed ?? 0);
      for (const [name, actor] of Object.entries(actors)) {
        const key = name === 'dog' ? 'dog_intro' : 'guard_intro';
        const duration = actor.clipDurations?.[key] ?? additions?.clips?.[key]?.duration;
        if (!(duration > 0) || !actor.animationNames?.includes(key)) continue;
        const oldTime = introTimes.get(actor) ?? 0;
        // Source Play starts the intro immediately, then CrossFadeQueued Run(.2).
        // Sampling the clip-end boundary here is a Three.js scheduling adapter.
        if (oldTime < duration) {
          actor.setAnimation(key, undefined, `intro-${introGeneration}`, { fade: 0 });
          actor.setTimeScale?.(1);
          actor.mixer.update(Math.max(0, Math.min(elapsed, duration) - oldTime));
        }
        if (elapsed >= duration) {
          actor.setAnimation('run', undefined, null, { fade: .2 });
          actor.setTimeScale?.(1);
          actor.mixer.update(Math.max(0, elapsed - Math.max(oldTime, duration)));
        }
        introTimes.set(actor, elapsed);
      }
      previousPhase = phase;
      return;
    }
    if (previousPhase === 'intro') {
      // Source FollowingGuard.OnEnable resets these independent physics values.
      xVelocity = floorVelocity = verticalSpeed = 0; floor = p.lastGroundedY ?? 0;
      object.position.set(p.x, floor, state.stumble.guardDistanceNative * .1);
    }
    previousPhase = phase;
    clock += dt;
    const crashed = phase === 'gameover';
    const distance = state.stumble.guardDistanceNative;
    const speedRatio = state.speed / 11;
    if (!crashed) { timeline = selected = null; view.catchAvatar = null; crashElapsed = 0; }
    else {
      if (crashElapsed === 0 && state.reaction?.name !== 'death_moving_train' && pools.caughtLeft.length && pools.caughtRight.length) {
        selected = selectCatchSequence({ ...pools, characterXNative: p.x * 10, trackXNative: (p.lane - 1) * 20, random }).sequence;
        timeline = new SourceCatchTimeline(selected);
      }
      if (crashElapsed === 0) { queue = []; pose = null; }
      crashElapsed += dt;
    }
    for (const event of events) {
      if (event.type === 'jump' || event.type === 'roll') queue.push({ type: event.type, at: clock + distance * .1 / state.speed,
        velocity: Math.sqrt(2 * 20 * (event.height ?? p.jumpHeight ?? 2)) });
      if (event.type === 'lane' && !crashed && p.grounded) pose = { name: event.direction < 0 ? 'left' : 'right', until: clock + .52 / speedRatio, token: clock, speed: speedRatio };
    }
    for (const event of queue.filter(event => event.at <= clock)) {
      if (event.type === 'jump') { verticalSpeed = event.velocity * CLASSIC_MOTION_SOURCE.guardJumpVelocityFactor; pose = { name: 'jump', until: clock + .92, token: clock }; }
      else verticalSpeed = -event.velocity;
    }
    queue = queue.filter(event => event.at > clock);
    const opacity = crashed ? 1 : THREE.MathUtils.clamp((30 - distance) / 12, 0, 1);
    object.visible = phase !== 'ready' && !state.flight && opacity > .001;
    for (const material of materials) { material.opacity = opacity; material.depthWrite = opacity > .95; }
    if (timeline) {
      const sample = timeline.step(dt);
      object.position.lerp(new THREE.Vector3(p.x, p.y, 0), sample.guardApproachProgress);
      view.catchAvatar = { name: selected.avatarKey, time: sample.avatarTime, weight: sample.avatarWeight, token: `catch-${state.reaction?.token}` };
    } else {
      [object.position.x, xVelocity] = smooth(object.position.x, p.x, xVelocity, .1, dt);
      [floor, floorVelocity] = smooth(floor, p.lastGroundedY ?? 0, floorVelocity, .3, dt);
      if (object.position.y > floor) verticalSpeed -= 20 * dt;
      object.position.y = Math.max(object.position.y + verticalSpeed * dt, floor);
      object.position.z = crashed ? THREE.MathUtils.lerp(distance * .1, 1, THREE.MathUtils.smoothstep(crashElapsed, 0, .7)) : distance * .1;
    }
    for (const [name, actor] of Object.entries(actors)) {
      const animation = timeline ? selected.guardKey ?? 'catchup_1'
        : crashed ? state.reaction?.name === 'death_moving_train' ? crashElapsed >= .8 ? 'death_moving_train' : 'run'
          : crashElapsed >= .7 && name === 'guard' ? 'catchup_1' : 'run'
        : pose?.until > clock ? pose.name : 'run';
      actor.setAnimation(animation, undefined, timeline ? `catch-${state.reaction?.token}` : pose?.until > clock ? pose.token : null, { fade: timeline ? .2 : .1 });
      if (animation === 'run' || animation === 'left' || animation === 'right') actor.setTimeScale?.(speedRatio);
      if (object.visible) actor.mixer.update(dt);
    }
  } };
  return view;
}
