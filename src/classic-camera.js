/**
 * Classic CharacterCamera native fallback. Evidence and source byte ranges:
 * analysis/classic/camera-v3/camera-findings.json.
 * All public positions use browser units (10 native units = 1) and world +Z
 * forward. The renderer owns the final +Z-to-view conversion and aspect resize.
 * This ports native fallback bodies, not remotely supplied XLua overrides.
 */
export const CLASSIC_CAMERA = Object.freeze({
  targetOffset: Object.freeze([0, 2, 0]),
  positionOffset: Object.freeze([0, 3.3, -3.3]),
  targetSmooth: Object.freeze([.05000000074505806, .10000000149011612, 0]),
  positionSmooth: Object.freeze([0, 0, 0]),
  transitionSeconds: .5,
  modifierX: .75, modifierY: .5,
  tunnelDelta: -1,
  minVectorDeltaTime: .004999999888241291,
  jumpTargetFloor: -.5, jumpTargetCeiling: 2.5,
  jumpFactor: .5, jumpFactorRate: 2,
  doubleJumpHigherFactor: .800000011920929,
  jetpackModifierX: .8999999761581421,
  jetpackSmoothX: .05000000074505806,
  shakeSeconds: .30000001192092896,
  shakeMagnitudeNative: 100,
});

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const clamp01 = x => clamp(x, 0, 1);
const lerp = (a, b, t) => a + (b - a) * clamp01(t);
const smoothstep = t => { t = clamp01(t); return t * t * (3 - 2 * t); };
const add = (a, b) => a.map((x, i) => x + b[i]);
const RAD = Math.PI / 180;

/** Unity Mathf.SmoothDamp 110802; maxSpeed is infinity in these camera callers. */
export function cameraSmoothDamp(value, target, velocity, smoothTime, dt) {
  smoothTime = Math.max(.00009999999747378752, smoothTime);
  const omega = 2 / smoothTime, x = omega * dt;
  const decay = 1 / (1 + x + .47999998927116394 * x * x + .23499999940395355 * x * x * x);
  const change = value - target, temp = (velocity + omega * change) * dt;
  let next = target + (change + temp) * decay;
  let nextVelocity = (velocity - omega * temp) * decay;
  if ((target - value > 0) === (next > target)) {
    next = target;
    nextVelocity = dt > 0 ? 0 : velocity;
  }
  return { value: Number.isNaN(next) ? value : next, velocity: nextVelocity };
}

class SmoothVector {
  constructor(value, times) {
    this.value = [...value]; this.target = [...value];
    this.velocity = [0, 0, 0]; this.times = [...times];
  }
  update(dt) {
    for (let i = 0; i < 3; i++) {
      if (this.times[i] === 0) this.value[i] = this.target[i];
      else {
        const next = cameraSmoothDamp(this.value[i], this.target[i], this.velocity[i],
          this.times[i], Math.max(CLASSIC_CAMERA.minVectorDeltaTime, dt));
        this.value[i] = next.value; this.velocity[i] = next.velocity;
      }
    }
  }
}

/** UpdateFOV 82645 plus Game.Intro's final FOV assignment. */
export function classicCameraFov(aspect, screenAspect = aspect) {
  if (!(aspect > 0) || !(screenAspect > 0)) throw new RangeError('Camera aspect must be positive');
  const runningField = screenAspect > .5625 ? 71 * screenAspect : 40;
  return {
    runningField,
    running: runningField / aspect,
    menu: screenAspect < .5625 ? runningField / aspect : 74.57140350341797,
  };
}

function curveValue(keys, time) {
  if (time <= keys[0][0]) return keys[0][1];
  if (time >= keys.at(-1)[0]) return keys.at(-1)[1];
  const right = keys.findIndex(key => key[0] >= time), a = keys[right - 1], b = keys[right];
  const span = b[0] - a[0], t = (time - a[0]) / span;
  return (2 * t ** 3 - 3 * t ** 2 + 1) * a[1]
    + (t ** 3 - 2 * t ** 2 + t) * span * a[3]
    + (-2 * t ** 3 + 3 * t ** 2) * b[1]
    + (t ** 3 - t ** 2) * span * b[2];
}

export function jetpackCameraBlend(ratio) {
  return clamp01(curveValue([
    [0, -.01249999925494194, 2, 2],
    [.21918271481990814, .7289865016937256, 1.0784529447555542, 1.0784529447555542],
    [1, 1.0034090280532837, 0, 0],
  ], ratio));
}

/** EnterCameraModifier82659 + APK libunity AddKey/SmoothTangents. Inserting
 * the middle key smooths BOTH existing first and new middle keys. The final
 * explicit Keyframe insertion preserves their slopes. Evidence: camera-v5. */
export function tunnelCameraKeys(length, delta = CLASSIC_CAMERA.tunnelDelta) {
  if (!(length > 0) || !Number.isFinite(length) || !Number.isFinite(delta)) throw new RangeError('Invalid tunnel curve');
  const nativeLength = Math.fround(length * 10), middle = Math.fround(nativeLength / 2);
  const slope = Math.fround(Math.fround(delta * 10) / middle), lastSlope = Math.fround(.001);
  return [[0, 0, slope, slope], [middle * .1, delta, slope, slope],
    [nativeLength * .1, 0, lastSlope, lastSlope]];
}

export function tunnelCameraDelta(distance, length, delta = CLASSIC_CAMERA.tunnelDelta) {
  return curveValue(tunnelCameraKeys(length, delta), distance);
}

function angles(position, target) {
  const dx = target[0] - position[0], dz = target[2] - position[2];
  return {
    pitch: Math.atan2(position[1] - target[1], Math.hypot(dx, dz)) / RAD,
    yaw: Math.atan2(dx, dz) / RAD,
    distance: Math.hypot(dx, target[1] - position[1], dz) || 1,
  };
}
function lookTarget(position, pitch, yaw, distance) {
  const c = Math.cos(pitch * RAD), s = Math.sin(pitch * RAD);
  return add(position, [Math.sin(yaw * RAD) * c * distance, -s * distance, Math.cos(yaw * RAD) * c * distance]);
}
function lerpAngle(a, b, t) {
  let d = ((b - a) % 360 + 360) % 360;
  if (d > 180) d -= 360;
  return a + d * clamp01(t);
}

export class ClassicCamera {
  constructor({ aspect = 9 / 16, screenAspect = aspect, config = {} } = {}) {
    this.config = { ...CLASSIC_CAMERA, ...config };
    this.aspect = aspect; this.screenAspect = screenAspect;
    this.reset();
  }

  reset({ characterPosition = [0, 0, 0], fov } = {}) {
    const c = this.config;
    this.mode = 'running'; this.lastDeltaYFactor = 0; this.lastSneakers = false;
    this.sourceTarget = add(characterPosition, c.targetOffset);
    this.sourceTarget[0] *= c.modifierX;
    this.sourcePosition = [this.sourceTarget[0], characterPosition[1] + c.positionOffset[1], characterPosition[2]];
    this.targetSmooth = new SmoothVector(this.sourceTarget, c.targetSmooth);
    this.positionSmooth = new SmoothVector(this.sourcePosition, c.positionSmooth);
    this.fov = fov ?? classicCameraFov(this.aspect, this.screenAspect).running;
    this.transitionTime = c.transitionSeconds;
    this.modifier = null; this.flight = null; this.shake = null;
    this.fovTween = null; this.fovPulse = null;
    this.shakeOffset = [0, 0, 0]; this.lastSourceZ = characterPosition[2]; this.speed = 0;
    this.pose = { position: [this.sourcePosition[0], this.sourcePosition[1], this.sourceTarget[2] + c.positionOffset[2]],
      target: [...this.sourceTarget], fov: this.fov };
    return this.snapshot();
  }

  /** Browser resize policy: call at resize, not every frame or during intro. */
  setAspect(aspect, screenAspect = aspect, { applyRunningFov = true } = {}) {
    const fov = classicCameraFov(aspect, screenAspect);
    this.aspect = aspect; this.screenAspect = screenAspect;
    if (applyRunningFov) this.fov = fov.running;
    return fov;
  }

  /** External source Animation/intro pose, in the same world +Z coordinates. */
  setPose({ position, target, fov = this.fov }) {
    this.pose = { position: [...position], target: [...target], fov };
    this.sourceTarget = [...target];
    this.sourcePosition = [position[0], position[1], position[2] - this.config.positionOffset[2]];
    this.fov = fov; this.mode = 'external';
    return this.snapshot();
  }

  enterRunning() {
    this.mode = 'running'; this.flight = null;
    this.targetSmooth = new SmoothVector(this.sourceTarget, this.config.targetSmooth);
    this.positionSmooth = new SmoothVector(this.sourcePosition, this.config.positionSmooth);
    this.startTransformTransition();
    return this.snapshot();
  }

  startTransformTransition() {
    this.previousY = this.pose.position[1];
    this.previousPitch = angles(this.pose.position, this.pose.target).pitch;
    this.transitionTime = 0;
  }
  sneakersChanged(active) {
    this.lastSneakers = active;
    this.startTransformTransition();
  }

  beginHeadstartFov() {
    const runningField = classicCameraFov(this.aspect, this.screenAspect).runningField;
    this.fovTween = { start: this.fov, target: (runningField + 10) / clamp(this.aspect, Math.fround(.56), Math.fround(1.78)),
      elapsed: 0, duration: 1, reverting: false };
  }
  endHeadstartFov() {
    this.fovTween = { start: this.fov, target: classicCameraFov(this.aspect, this.screenAspect).running,
      elapsed: 0, duration: 1, reverting: true };
  }
  pulseHeadstartFov(duration = Math.fround(.8), multiplier = Math.fround(1.2)) {
    if (this.fovPulse) return false;
    this.fovPulse = { start: this.fov, duration, multiplier, elapsed: 0 };
    return true;
  }
  stepFov(dt, { runningOrJetpack = true } = {}) {
    const tween = this.fovTween;
    if (tween) {
      tween.elapsed += dt;
      this.fov = tween.reverting && !runningOrJetpack ? tween.target
        : lerp(tween.start, tween.target, tween.elapsed / tween.duration);
      if (tween.elapsed >= tween.duration || tween.reverting && !runningOrJetpack) this.fovTween = null;
    }
    // Two native coroutines may write the same field. Pulse-last ordering is
    // an explicit browser scheduling adapter; endpoints/times are recovered.
    const pulse = this.fovPulse;
    if (pulse) {
      pulse.elapsed += dt;
      const u = clamp01(pulse.elapsed / pulse.duration);
      this.fov = lerp(pulse.start, pulse.start * pulse.multiplier, u <= .5 ? u * 2 : (1 - u) * 2);
      if (u >= 1) this.fovPulse = null;
    }
  }

  enterCameraModifier({ startZ, length, evaluateCurve }) {
    if (!Number.isFinite(startZ) || !(length > 0)) throw new RangeError('Invalid camera modifier span');
    const knownKeys = tunnelCameraKeys(length, this.config.tunnelDelta);
    this.modifier = { startZ, length, knownKeys,
      evaluateCurve: evaluateCurve ?? (distance => curveValue(knownKeys, distance)) };
  }
  exitCameraModifier() { this.modifier = null; }

  /** The renderer supplies inside-unit-sphere samples; Unity's RNG is not emulated. */
  startShake() { this.shake = { elapsed: 0, diff: [0, 0, 0] }; }
  resetShake() { this.shake = null; this.shakeOffset = [0, 0, 0]; }
  sampleShake(dt, sample = [0, 0, 0]) {
    if (!this.shake) return;
    const s = this.shake, t = clamp01(s.elapsed / this.config.shakeSeconds);
    s.diff = add(s.diff, sample);
    this.shakeOffset = s.diff.map(v => v * (1 - t) * this.config.shakeMagnitudeNative * dt * .1);
    s.elapsed += dt;
    if (t >= 1) this.resetShake();
  }

  beginJetpack(characterPosition) {
    this.mode = 'jetpack';
    this.flight = {
      initialPosition: [...this.sourcePosition], initialTarget: [...this.sourceTarget],
      initialOffsetY: this.pose.position[1] - characterPosition[1],
      x: this.pose.position[0], xTarget: this.pose.position[0], xVelocity: 0,
    };
    // Native mode 2 bypasses ordinary follow, shake and transform tween.
  }

  step(dt, { position, lastGroundedY = 0, grounded = true, sneakers = false,
    jumperBoard = false, doubleJumping = false, jumpingHigher = false, superVIP2 = false,
    insideSubway = false, subwayMaxY = Infinity, jetpack = null, enabled = true,
    dontMoveInY = false, shakeSample = [0, 0, 0], runningOrJetpack = true } = {}) {
    if (!Number.isFinite(dt) || dt < 0 || !position?.every(Number.isFinite)) throw new RangeError('Invalid camera step');
    if (!enabled) return this.snapshot();
    this.stepFov(dt, { runningOrJetpack });
    const c = this.config;
    if (jetpack?.active) {
      if (this.mode !== 'jetpack') this.beginJetpack(position);
      const f = this.flight;
      // Source SmoothDampFloat Update precedes assigning this frame's target.
      const x = cameraSmoothDamp(f.x, f.xTarget, f.xVelocity, c.jetpackSmoothX, dt);
      f.x = x.value; f.xVelocity = x.velocity; f.xTarget = position[0] * c.jetpackModifierX;
      const ratio = (position[2] - jetpack.startDistance) / jetpack.takeoffDistance;
      if (jetpack.takingOff) {
        const q = smoothstep(ratio), blend = jetpackCameraBlend(ratio);
        this.sourcePosition = [f.x,
          lerp(f.initialPosition[1], position[1] + lerp(f.initialOffsetY, c.positionOffset[1], q), blend),
          lerp(f.initialPosition[2], position[2], blend)];
        this.sourceTarget = [f.x,
          lerp(f.initialTarget[1], position[1] + c.targetOffset[1], blend),
          lerp(f.initialTarget[2], position[2], blend)];
      } else {
        this.sourcePosition = [f.x, position[1] + c.positionOffset[1], position[2]];
        this.sourceTarget = [f.x, position[1] + c.targetOffset[1], position[2]];
      }
      this.pose = { position: [this.sourcePosition[0], this.sourcePosition[1], this.sourcePosition[2] + c.positionOffset[2]],
        target: [...this.sourceTarget], fov: this.fov };
      // Mode 2 updates the ordinary smoothing helpers for the eventual return.
      this.targetSmooth.value = [...this.sourceTarget]; this.targetSmooth.update(dt);
      this.positionSmooth.target = [...this.sourcePosition]; this.positionSmooth.update(dt);
    } else {
      if (this.mode === 'jetpack') { this.resetShake(); this.enterRunning(); }
      if (this.mode !== 'running') return this.snapshot();
      if (sneakers !== this.lastSneakers) this.startTransformTransition();
      this.lastSneakers = sneakers;
      let factor = sneakers || jumperBoard || doubleJumping || superVIP2
        ? (doubleJumping && jumpingHigher ? c.doubleJumpHigherFactor : c.jumpFactor) : 0;
      if (!grounded) factor = lerp(this.lastDeltaYFactor, factor, c.jumpFactorRate * dt);
      let targetY = this.targetSmooth.target[1];
      if (!dontMoveInY) {
        targetY = Math.min(position[1], lastGroundedY)
          + Math.max(0, position[1] - lastGroundedY) * factor + c.targetOffset[1];
        this.lastDeltaYFactor = factor;
      }
      this.targetSmooth.target = [(position[0] + c.targetOffset[0]) * c.modifierX,
        targetY, position[2] + c.targetOffset[2]];
      this.targetSmooth.update(dt);
      this.targetSmooth.value[1] = clamp(this.targetSmooth.value[1],
        position[1] + c.jumpTargetFloor, position[1] + c.jumpTargetCeiling);
      const m = this.modifier;
      const deltaY = m && position[2] < m.startZ + m.length ? m.evaluateCurve(position[2] - m.startZ) : 0;
      this.sourceTarget = [...this.targetSmooth.value];
      this.sourceTarget[1] += deltaY * c.modifierY;
      this.positionSmooth.target = [c.positionOffset[0] === 0 ? this.sourceTarget[0] : position[0] + c.positionOffset[0],
        this.sourceTarget[1] + c.positionOffset[1] - c.targetOffset[1], position[2]];
      this.positionSmooth.update(dt);
      this.sourcePosition = [...this.positionSmooth.value]; this.sourcePosition[1] += deltaY;
      if (insideSubway) this.sourcePosition[1] = Math.min(this.sourcePosition[1], subwayMaxY);
      const actualPosition = [this.sourcePosition[0], this.sourcePosition[1], this.sourceTarget[2] + c.positionOffset[2]];
      const a = angles(actualPosition, this.sourceTarget);
      let pitch = a.pitch;
      if (this.transitionTime < c.transitionSeconds) {
        const t = this.transitionTime / c.transitionSeconds;
        actualPosition[1] = lerp(this.previousY, this.sourcePosition[1], smoothstep(t));
        pitch = lerpAngle(this.previousPitch, pitch, t);
        this.transitionTime += dt;
      }
      this.sampleShake(dt, shakeSample);
      const target = lookTarget(actualPosition, pitch, a.yaw, a.distance);
      this.pose = { position: add(actualPosition, this.shakeOffset), target: add(target, this.shakeOffset), fov: this.fov };
    }
    this.speed = dt > 0 ? (this.sourcePosition[2] - this.lastSourceZ) / dt : 0;
    this.lastSourceZ = this.sourcePosition[2];
    return this.snapshot();
  }

  snapshot() {
    return { position: [...this.pose.position], target: [...this.pose.target], fov: this.fov,
      mode: this.mode, sourceTarget: [...this.sourceTarget], sourcePosition: [...this.sourcePosition],
      pitchDegrees: angles(this.pose.position, this.pose.target).pitch,
      speed: this.speed, jumpFactor: this.lastDeltaYFactor,
      transitionTime: this.transitionTime, shakeOffset: [...this.shakeOffset] };
  }
}

export default ClassicCamera;
