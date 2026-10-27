/**
 * Static native fallback for classic Character/Game stumble state.
 * Evidence: analysis/classic/collision/collision-findings.json.
 * Geometry, collision-enter detection, speed changes, Game.Die/hoverboard
 * protection and visual presentation remain the caller's responsibility.
 */
export const CLASSIC_COLLISION_SOURCE = Object.freeze({
  stumbleSeconds: 5,
  deathDelaySeconds: 0.20000000298023224,
  guardDistanceMinNative: 10,
  guardDistanceMaxNative: 30,
  guardCatchUpSeconds: 0.699999988079071,
  guardRetreatSeconds: 1.5,
  cornerMemorySeconds: 1,
  reboundDurationPerLane: 0.5,
});

const smoothstep = t => (t = Math.min(1, Math.max(0, t)), t * t * (3 - 2 * t));

export class ClassicCollisionState {
  constructor() { this.reset(); }

  reset() {
    this.isStumbling = false;
    this.timeLeft = 0;
    this.guardDistanceNative = CLASSIC_COLLISION_SOURCE.guardDistanceMaxNative;
    this.guardClose = false;
    this._guardTween = null;
    this._pendingDeaths = [];
    return this.snapshot();
  }

  get pendingDeath() { return this._pendingDeaths.length ? Math.min(...this._pendingDeaths) : 0; }
  get hasPendingDeath() { return this._pendingDeaths.length > 0; }

  snapshot() {
    return { isStumbling: this.isStumbling, timeLeft: this.timeLeft,
      pendingDeath: this.pendingDeath, hasPendingDeath: this.hasPendingDeath,
      guardDistanceNative: this.guardDistanceNative, guardClose: this.guardClose };
  }

  _moveGuard(target, duration) {
    this._guardTween = { start: this.guardDistanceNative, target, duration, elapsed: 0 };
  }

  _stepGuard(dt) {
    const tween = this._guardTween;
    if (!tween) return;
    tween.elapsed += dt;
    this.guardDistanceNative = tween.start + (tween.target - tween.start) * smoothstep(tween.elapsed / tween.duration);
    if (tween.elapsed >= tween.duration) this._guardTween = null;
  }

  /**
   * Game.OnStumble reads the OLD flag before Character.StartStumble(!safe).
   * Therefore safe=true clears future vulnerability, but does not suppress a
   * death sequence already requested by the old flag. Each notification can
   * enqueue a sequence, as in the native coroutine path.
   *
   * critical is an explicit caller adapter for branches that ALSO call
   * NotifyCriticalHit after HandleStumble; the native OnStumble callback itself
   * does not interpret this argument as an immediate death instruction.
   */
  stumble({ safe = false, critical = false, flying = false, running = true } = {}) {
    if (flying || !running) return { ...this.snapshot(), stumbled: false, deathRequested: false, fatal: false, reason: null };
    const deathRequested = this.isStumbling;
    if (deathRequested) this._pendingDeaths.push(CLASSIC_COLLISION_SOURCE.deathDelaySeconds);
    this.isStumbling = !safe;
    this.timeLeft = CLASSIC_COLLISION_SOURCE.stumbleSeconds;
    this.guardClose = true;
    this._moveGuard(CLASSIC_COLLISION_SOURCE.guardDistanceMinNative, CLASSIC_COLLISION_SOURCE.guardCatchUpSeconds);
    return { ...this.snapshot(), stumbled: true, deathRequested, fatal: !!critical,
      reason: critical ? 'critical-hit' : deathRequested ? 'repeated-stumble' : null };
  }

  /** Character.StopStumble: clears the flag and requests guard retreat. */
  stopStumble() {
    this.isStumbling = false;
    this.timeLeft = 0;
    if (this.guardClose) {
      this.guardClose = false;
      this._moveGuard(CLASSIC_COLLISION_SOURCE.guardDistanceMaxNative, CLASSIC_COLLISION_SOURCE.guardRetreatSeconds);
    }
    // Native StopStumble does not cancel the separate Game death coroutine.
    return this.snapshot();
  }

  /**
   * dt is scaled gameplay time. Pause freezes both WaitForSeconds timers and
   * guard tweens. At death expiry the native coroutine rechecks running/flight.
   * The browser processes timers before new contacts at the exact 5s boundary;
   * Unity's coroutine-vs-physics same-frame ordering was not observed.
   */
  step(dt, { paused = false, running = true, flying = false } = {}) {
    if (!Number.isFinite(dt) || dt < 0) throw new Error('Invalid collision step');
    let fatal = false, recovered = false, deathSequencesCompleted = 0;
    if (!paused) {
      const future = [];
      for (const delay of this._pendingDeaths) {
        const remaining = delay - dt;
        if (remaining <= 0) deathSequencesCompleted++;
        else future.push(remaining);
      }
      this._pendingDeaths = future;
      fatal = deathSequencesCompleted > 0 && running && !flying;
      if (this.timeLeft > 0 && dt >= this.timeLeft) {
        const untilRecovery = this.timeLeft;
        this._stepGuard(untilRecovery);
        this.stopStumble();
        this._stepGuard(dt - untilRecovery);
        recovered = true;
      } else {
        this.timeLeft = Math.max(0, this.timeLeft - dt);
        this._stepGuard(dt);
      }
    }
    return { ...this.snapshot(), fatal, reason: fatal ? 'repeated-stumble' : null, recovered, deathSequencesCompleted };
  }
}
