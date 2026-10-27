/**
 * Small, source-derived animation rules, not an animation renderer.
 * Evidence: analysis/classic/motion-v2/findings.json. All coordinates/velocities
 * passed to these functions use original Unity units unless named otherwise.
 * Game state, animation availability, skeletons and account/UI flow are external.
 */
export const CLASSIC_MOTION_SOURCE = Object.freeze({
  jumpFade: 0.15000000596046448,
  dodgeFade: 0.20000000298023224,
  dodgeToRunFade: 0.019999999552965164,
  boardDodgeToRunFade: 0.4000000059604645,
  rollFade: 0.10000000149011612,
  rollToRunFade: 0.10000000149011612,
  boardRollToRunFade: 0.20000000298023224,
  landingFade: 0.05000000074505806,
  landingToRunFade: 0.10000000149011612,
  hangtimeFade: 0.30000001192092896,
  catchFade: 0.20000000298023224,
  catchOffsetDivisor: 25,
  catchSideThresholdNative: 20,
  guardJumpVelocityFactor: 0.699999988079071,
});

/** The normal and small jump roles use the SAME serialized jump pool by default. */
export function jumpRole({ heightNative = 0, normalJumpHeightNative = 20, noLandStumbling = false } = {}) {
  if (noLandStumbling) return 'stumbleNoLand'; // NoFloorMutator flag, not generic falling.
  return heightNative !== 0 && heightNative <= normalJumpHeightNative * 0.5 ? 'smallJump' : 'jump';
}

/** Supply velocity before the landing event zeroes it. All three land roles
 * use the SAME serialized landing pool in default InitializeAnimations. */
export function landingRole(velocityNative, { rolling = false } = {}) {
  if (!Number.isFinite(velocityNative)) throw new RangeError('Invalid landing velocity');
  if (rolling) return null;
  if (velocityNative >= -20) return 'run';
  if (velocityNative < -150) return 'bigLand';
  return velocityNative < -40 ? 'land' : 'smallLand';
}

/** Normal classic event policy. Flying/board animation banks are chosen outside. */
export function laneAnimationPlan({ direction, grounded, jumping, flying = false, dead = false,
  hitMovingPlaying = false, hoverboard = false } = {}) {
  if (!['left', 'right'].includes(direction)) throw new RangeError('Invalid lane direction');
  if (hitMovingPlaying) return { play: null, queue: null };
  const play = (grounded || flying) && !dead ? (direction === 'left' ? 'dodgeLeft' : 'dodgeRight') : null;
  return { play, fade: CLASSIC_MOTION_SOURCE.dodgeFade,
    queue: jumping ? null : 'run',
    queueFade: hoverboard ? CLASSIC_MOTION_SOURCE.boardDodgeToRunFade : CLASSIC_MOTION_SOURCE.dodgeToRunFade };
}

/** The caller supplies its RNG; no claim is made to reproduce Unity RNG state.
 * Duplicate entries remain weighted duplicates, and even singleton pools draw. */
export function pickSourceAnimation(pool, random) {
  if (!Array.isArray(pool) || pool.length === 0) throw new Error('Empty source animation pool');
  const u = random();
  if (!(u >= 0 && u < 1)) throw new RangeError('Animation RNG must return [0, 1)');
  return pool[Math.floor(u * pool.length)];
}

/** Native coroutine uses raw AnimationState.length as its wall-clock cap, not
 * length/speed. Disabled/interrupted animation can end rolling before that cap. */
export class SourceRollTimeline {
  constructor() { this.active = false; this.elapsed = 0; this.length = 0; }
  begin(clipLength) {
    if (this.active) return false;
    if (!(clipLength > 0) || !Number.isFinite(clipLength)) throw new RangeError('Invalid roll clip length');
    this.active = true; this.elapsed = 0; this.length = clipLength;
    return true;
  }
  step(dt, { enabled = true, rolling = true, paused = false } = {}) {
    validateDelta(dt);
    if (!this.active || paused) return false;
    this.elapsed += dt;
    if (this.elapsed >= this.length || !enabled || !rolling) {
      this.active = false;
      return true; // Caller invokes EndRoll once.
    }
    return false;
  }
}

/** CatchPlayer draws BOTH side indices before selecting a side. The argument
 * is Character.x - Character.GetTrackX(), not the world lane coordinate. */
export function selectCatchSequence({ caughtLeft, caughtRight, characterXNative, trackXNative,
  debugIndex = -1, random }) {
  const index = pool => {
    if (!Array.isArray(pool) || pool.length === 0) throw new Error('Missing source catch pool');
    if (Number.isInteger(debugIndex) && debugIndex >= 0 && debugIndex < pool.length) return debugIndex;
    const u = random();
    if (!(u >= 0 && u < 1)) throw new RangeError('Catch RNG must return [0, 1)');
    return Math.floor(u * pool.length);
  };
  const leftIndex = index(caughtLeft), rightIndex = index(caughtRight);
  const side = characterXNative - trackXNative < CLASSIC_MOTION_SOURCE.catchSideThresholdNative ? 'left' : 'right';
  return { side, index: side === 'left' ? leftIndex : rightIndex,
    sequence: side === 'left' ? caughtLeft[leftIndex] : caughtRight[rightIndex] };
}

/** Avatar animation is enabled at normalizedTime=0 immediately, with weight=0.
 * Its time therefore advances during the delay; only weight waits then fades.
 * The source per-sequence waitTimeBeforeScreen is metadata, NOT a popup timer:
 * this APK's Game.OnCatchPlayer ignores it and uses Game.reviveWaitTime.
 */
export class SourceCatchTimeline {
  constructor(sequence) {
    if (!sequence || !Number.isFinite(sequence.catchAvatarAnimationPlayOffset)
      || sequence.catchAvatarAnimationPlayOffset < 0) throw new RangeError('Invalid source catch sequence');
    this.sequence = sequence;
    this.delay = Math.fround(sequence.catchAvatarAnimationPlayOffset / CLASSIC_MOTION_SOURCE.catchOffsetDivisor);
    this.elapsed = 0;
  }
  sample() {
    return { avatarEnabled: true, avatarTime: this.elapsed,
      avatarWeight: Math.min(1, Math.max(0, (this.elapsed - this.delay) / CLASSIC_MOTION_SOURCE.catchFade)),
      guardApproachProgress: this.delay === 0 ? 1 : Math.min(1, this.elapsed / this.delay),
      delay: this.delay };
  }
  step(dt, { paused = false } = {}) {
    validateDelta(dt);
    if (!paused) this.elapsed += dt;
    return this.sample();
  }
}

function validateDelta(dt) {
  if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Invalid animation delta time');
}
