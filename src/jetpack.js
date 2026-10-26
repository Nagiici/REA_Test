/**
 * Ordinary classic Jetpack native fallback, adapted at 10 native units = 1 unit.
 * Evidence: analysis/flight/jetpack/jetpack-native-findings.json, methods82464,
 * 82411/82412 and83840. The caller owns forward motion, route insertion, coins,
 * collisions and the normal-gravity descent after `ended`.
 */
export const JETPACK_SECONDS = Object.freeze([8, 9, 10.5, 12.5, 15, 19, 25]);
export const JETPACK = Object.freeze({
  speedMultiplier: 2,
  height: 9.5,
  takeoffSeconds: 1.5,
  landingLength: 18,
  targetGrid: 18,
  laneChangeLength: 6,
  coinOffset: 20,
  stopBeforeLanding: 5,
  normalMinSpeed: 11,
});

const clamp01 = value => Math.max(0, Math.min(1, value));
const smoothstep = value => { const t = clamp01(value); return t * t * (3 - 2 * t); };

export class Jetpack {
  constructor({ tier = 0 } = {}) {
    if (!Number.isInteger(tier) || tier < 0 || tier >= JETPACK_SECONDS.length) throw new RangeError('Invalid jetpack upgrade tier');
    this.tier = tier;
    this.reset();
  }

  reset() {
    this.active = false;
    this.takingOff = false;
    this.ended = false;
    this.startDistance = 0;
    this.targetZ = 0;
    this.startY = 0;
    this.y = 0;
    this.levelSpeed = 0;
    this.speed = 0;
    this.takeoffDistance = 0;
    this.duration = JETPACK_SECONDS[this.tier];
    this.elapsed = 0;
    this.timeLeft = 0;
    this.initialTimeLeft = 0;
    this.coinStartDistance = 0;
    this.coinLength = 0;
    this.coinEndDistance = 0;
    return this.snapshot();
  }

  begin({ distance, y, levelSpeed, minimumTargetZ = 0 }) {
    if (![distance, y, levelSpeed, minimumTargetZ].every(Number.isFinite) || levelSpeed <= 0) throw new RangeError('Jetpack needs finite positions and positive level speed');
    this.startDistance = distance;
    this.startY = y;
    this.y = y;
    this.levelSpeed = levelSpeed;
    this.speed = levelSpeed * JETPACK.speedMultiplier;
    this.duration = JETPACK_SECONDS[this.tier];
    this.takeoffDistance = this.speed * JETPACK.takeoffSeconds;
    const desired = distance + this.speed * (this.duration + JETPACK.takeoffSeconds) - JETPACK.landingLength / 2;
    // The source minimum section endpoint is itself grid-aligned. A web caller
    // may supply an already-planned safe endpoint; it is never shortened here.
    this.targetZ = Math.max(minimumTargetZ, Math.ceil(desired / JETPACK.targetGrid) * JETPACK.targetGrid);
    const stopMargin = JETPACK.stopBeforeLanding * levelSpeed / JETPACK.normalMinSpeed;
    this.initialTimeLeft = (this.targetZ - distance - stopMargin) / this.speed;
    this.timeLeft = Math.max(0, this.initialTimeLeft);
    this.coinStartDistance = distance + this.takeoffDistance + JETPACK.coinOffset;
    this.coinLength = (this.initialTimeLeft - JETPACK.takeoffSeconds) * this.speed - JETPACK.coinOffset;
    this.coinEndDistance = this.coinStartDistance + this.coinLength;
    this.elapsed = 0;
    this.active = true;
    this.takingOff = true;
    this.ended = false;
    return this.snapshot();
  }

  /** `distance` is the frame-start position, before the caller advances z. */
  step(dt, { distance }) {
    if (!Number.isFinite(dt) || dt < 0 || !Number.isFinite(distance)) throw new RangeError('Invalid jetpack step');
    this.ended = false;
    if (!this.active) return this.snapshot();
    if (distance >= this.targetZ) {
      this.active = false;
      this.takingOff = false;
      this.ended = true;
      this.y = JETPACK.height;
      this.timeLeft = 0;
      // Ordinary RunningState restores level speed; the caller can immediately
      // substitute its current level speed if the level ramp advanced in flight.
      this.speed = this.levelSpeed;
      return this.snapshot();
    }
    const ratio = (distance - this.startDistance) / this.takeoffDistance;
    this.takingOff = ratio < 1;
    this.y = this.takingOff
      ? this.startY + (JETPACK.height - this.startY) * smoothstep(ratio)
      : JETPACK.height;
    this.elapsed += dt;
    // Native ActivePowerup time is a separate countdown; it may expire before
    // the distance-based flight. Only the displayed value is clamped here.
    this.timeLeft = Math.max(0, this.initialTimeLeft - this.elapsed);
    return this.snapshot();
  }

  snapshot() {
    return {
      active: this.active, takingOff: this.takingOff, ended: this.ended,
      y: this.y, speed: this.speed, levelSpeed: this.levelSpeed,
      timeLeft: this.timeLeft, initialTimeLeft: this.initialTimeLeft,
      duration: this.duration, elapsed: this.elapsed,
      startDistance: this.startDistance, targetZ: this.targetZ,
      takeoffDistance: this.takeoffDistance,
      laneChangeSeconds: this.active ? JETPACK.laneChangeLength / this.speed : 0,
      coinStartDistance: this.coinStartDistance, coinLength: this.coinLength,
      coinEndDistance: this.coinEndDistance,
      detectCollisions: !this.active,
      characterColliderEnabled: !this.active || !this.takingOff,
    };
  }
}

export default Jetpack;
