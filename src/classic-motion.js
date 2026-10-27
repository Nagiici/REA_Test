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
  heightTransitionMinNative: 70,
  heightTransitionMaxNative: 125,
  heightTransitionRollSpeedNative: -250,
  highRouteRollThresholdNative: 200,
  movingTrainTweenSeconds: .5,
  movingTrainCameraYOffsetNative: -33,
  movingTrainSinkDelay: .6,
  movingTrainSinkSeconds: 1,
  movingTrainSinkYNative: -5,
  guardResetCatchUpSeconds: 1.5,
});

/** FollowingGuard ShowEnemies/CatchUp/ResetCatchUpCoroutine visibility.
 * This is source GameObject activation, independent of any opacity/frustum.
 * Caller may send explicit lifecycle calls or its authoritative guardClose
 * value to step(). An already-dead guard does not hide when its wait ends. */
export class SourceGuardVisibility {
  constructor({ resetCatchUpSeconds = CLASSIC_MOTION_SOURCE.guardResetCatchUpSeconds } = {}) {
    if (!(resetCatchUpSeconds > 0) || !Number.isFinite(resetCatchUpSeconds)) throw new RangeError('Invalid guard retreat duration');
    this.resetCatchUpSeconds = resetCatchUpSeconds; this.reset();
  }
  reset() { this.isShowing = false; this.closeToCharacter = false; this.hideRemaining = null; return this.snapshot(); }
  beginIntro() { return this.catchUp(); }
  catchUp() {
    this.isShowing = true; this.closeToCharacter = true; this.hideRemaining = null;
    return this.snapshot();
  }
  resetCatchUp() {
    if (this.closeToCharacter) {
      this.closeToCharacter = false;
      // Distance retreat takes duration; the yielded audio fade takes twice it.
      this.hideRemaining = this.resetCatchUpSeconds * 2;
    }
    return this.snapshot();
  }
  snapshot() { return { isShowing: this.isShowing, closeToCharacter: this.closeToCharacter, hideRemaining: this.hideRemaining }; }
  step(dt, { guardClose, dead = false, paused = false } = {}) {
    validateDelta(dt);
    if (paused) return this.snapshot();
    if (guardClose === true && !this.closeToCharacter) this.catchUp();
    else if (guardClose === false && this.closeToCharacter) this.resetCatchUp();
    if (this.hideRemaining !== null) {
      this.hideRemaining -= dt;
      if (this.hideRemaining <= 1e-10) {
        this.hideRemaining = null;
        if (!dead) this.isShowing = false;
      }
    }
    return this.snapshot();
  }
}

/** Running.Begin82564 samples this on state entry, not on every airborne frame. */
export function runningTransitionFromHeight(heightNative) {
  return heightNative > CLASSIC_MOTION_SOURCE.heightTransitionMinNative
    && heightNative < CLASSIC_MOTION_SOURCE.heightTransitionMaxNative;
}

/** Character.Roll81948, followed by Running.HandleSwipe82543's route override.
 * Route-relative height is optional because a surface/roof height is NOT the
 * Route.GetRelativePosition origin. Ordinary default-route coordinates are flat. */
export function rollVerticalSpeed({ gravityNative = 200, jumpHeightNative = 20,
  transitionFromHeight = false, routeRelativeHeightNative = null } = {}) {
  if (routeRelativeHeightNative > CLASSIC_MOTION_SOURCE.highRouteRollThresholdNative)
    return -Math.sqrt(2 * gravityNative * routeRelativeHeightNative);
  return transitionFromHeight ? CLASSIC_MOTION_SOURCE.heightTransitionRollSpeedNative
    : -Math.sqrt(2 * gravityNative * jumpHeightNative);
}

/** Two separately gated native presentation tweens, in caller coordinates.
 * CharacterRendering82330 first moves X/Y toward the captured camera (Z stays
 * fixed). FollowingGuard17030 may later sink the captured position. Supply its
 * actual .6s capture if another presentation writer moved the actor meanwhile.
 * guardSequence must be an explicitly established sequence, not any crash. */
export function movingTrainPresentation({ elapsed, startPosition, cameraPosition,
  guardSequence = false, guardSinkStartPosition = null, unitScale = .1 }) {
  validateDelta(elapsed);
  if (!(unitScale > 0) || ![startPosition, cameraPosition].every(p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite)))
    throw new RangeError('Invalid moving-train presentation coordinates');
  const source = CLASSIC_MOTION_SOURCE;
  const target = [cameraPosition[0], cameraPosition[1] + source.movingTrainCameraYOffsetNative * unitScale, startPosition[2]];
  const blend = Math.min(1, elapsed / source.movingTrainTweenSeconds);
  let position = startPosition.map((v, i) => v + (target[i] - v) * blend);
  let stage = blend < 1 ? 'camera-tween' : 'hold';
  if (guardSequence && elapsed >= source.movingTrainSinkDelay) {
    const captured = guardSinkStartPosition ?? target;
    const sink = Math.min(1, (elapsed - source.movingTrainSinkDelay) / source.movingTrainSinkSeconds);
    position = [captured[0], captured[1] + (source.movingTrainSinkYNative * unitScale - captured[1]) * sink, captured[2]];
    stage = sink < 1 ? 'guard-sink' : 'finished';
  }
  return { position, stage };
}

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
