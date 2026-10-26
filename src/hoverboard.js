/**
 * Classic/default-board native fallback, in original Unity distance units.
 * Evidence: analysis/flight/hoverboard/findings.json and disassembly/605.asm.
 * Account inventory, rendering, route hiding and Character.Revive are adapters.
 */
export const HOVERBOARD_SOURCE = Object.freeze({
  duration: 30,
  crashParticleDelay: 0.14000000059604645,
  obstacleClearDistance: 250,
  cooldownDistance: 116,
  recoveryDistance: 90,
  reviveJumpHeight: 15,
  repeatedDeathGuard: 0.4000000059604645,
});

// Explicit browser policy: these are not recovered account values/native fixes.
export const HOVERBOARD_BROWSER_ADAPTER = Object.freeze({
  inventory: 3,
  rearmPolicy: 'distance-repair',
});

/**
 * source-latched preserves the recovered native cooldown flag: the coroutine
 * sets it at either ending and never clears it; HardReset clears it.
 * distance-repair is an opt-in browser fix: natural expiry can rearm, and a
 * crash rearms after the source 116 * speedNormalized distance has elapsed.
 */
export class Hoverboard {
  constructor({ inventory = 3, rearmPolicy = 'source-latched', duration = HOVERBOARD_SOURCE.duration } = {}) {
    if (!['source-latched', 'distance-repair'].includes(rearmPolicy)) throw new Error('Unknown hoverboard rearm policy');
    if (!Number.isInteger(inventory) || inventory < 0 || !Number.isFinite(duration) || duration <= 0) throw new Error('Invalid hoverboard configuration');
    this.options = { inventory, rearmPolicy, duration };
    this.reset();
  }

  reset({ inventory = this.options.inventory } = {}) {
    if (!Number.isInteger(inventory) || inventory < 0) throw new Error('Invalid local inventory');
    this.state = { inventory, active: false, flying: false, timeLeft: 0,
      cooldownBlocked: false, cooldownRemainingNative: 0, recoveryRemainingNative: 0,
      crashDelay: 0, crashPending: false, speedNormalizedAtHit: 1, deathGuardRemaining: 0 };
  }

  get visible() { return this.state.active && !this.state.flying; }
  get canActivate() { return !this.state.active && !this.state.flying && !this.state.cooldownBlocked && this.state.inventory > 0; }
  get protects() { return !this.state.flying && (this.state.active || this.state.deathGuardRemaining > 0); }

  activate({ flying = this.state.flying, allowed = true } = {}) {
    if (!allowed || flying || !this.canActivate) return false;
    this.state.inventory--;
    this.state.active = true;
    this.state.timeLeft = this.options.duration;
    return true;
  }

  /** Called when the game's fatal-hit path would call Game.Die. */
  hit({ speedNormalized = 1, flying = this.state.flying } = {}) {
    if (flying || !this.protects) return false;
    // Game.Die suppresses another call for .4 s, independently of board state.
    if (this.state.deathGuardRemaining > 0) return true;
    if (!Number.isFinite(speedNormalized) || speedNormalized <= 0) throw new Error('Invalid normalized speed');
    Object.assign(this.state, { active: false, timeLeft: 0, cooldownBlocked: true,
      crashPending: true, crashDelay: HOVERBOARD_SOURCE.crashParticleDelay,
      speedNormalizedAtHit: speedNormalized, deathGuardRemaining: HOVERBOARD_SOURCE.repeatedDeathGuard });
    return true;
  }

  /**
   * levelSpeed is native units/second (browser velocity / worldScale).
   * Returns [{type:'clearObstacles',distanceNative}, {type:'revive',jumpHeightNative}]
   * once after a crash; the caller implements geometry/physics and presentation.
   */
  step(dt, { levelSpeed = 0, pausedForFlight = false } = {}) {
    if (!Number.isFinite(dt) || dt < 0 || !Number.isFinite(levelSpeed) || levelSpeed < 0) throw new Error('Invalid hoverboard step');
    const s = this.state, events = [];
    s.flying = pausedForFlight;
    s.deathGuardRemaining = Math.max(0, s.deathGuardRemaining - dt);
    // Collection.PauseInJetpackMode pauses the iterator; GameStats also pauses
    // type 1's timer. Resume leaves the existing board and inventory intact.
    if (pausedForFlight) return events;
    if (s.active) {
      s.timeLeft = Math.max(0, s.timeLeft - dt);
      if (s.timeLeft === 0) {
        s.active = false;
        s.cooldownBlocked = this.options.rearmPolicy === 'source-latched';
        events.push({ type: 'expired' });
      }
      return events;
    }
    let recoveryDt = dt;
    if (s.crashPending) {
      recoveryDt = Math.max(0, dt - s.crashDelay);
      s.crashDelay = Math.max(0, s.crashDelay - dt);
      if (s.crashDelay > 0) return events;
      s.crashPending = false;
      const scale = s.speedNormalizedAtHit;
      s.cooldownRemainingNative = HOVERBOARD_SOURCE.cooldownDistance * scale;
      s.recoveryRemainingNative = HOVERBOARD_SOURCE.recoveryDistance * scale;
      events.push({ type: 'clearObstacles', distanceNative: HOVERBOARD_SOURCE.obstacleClearDistance * scale });
      events.push({ type: 'revive', jumpHeightNative: HOVERBOARD_SOURCE.reviveJumpHeight });
    }
    if (s.cooldownBlocked) {
      // Native iterates only while recoveryRemaining > 0. The opt-in browser
      // policy extends distance accounting until the cooldown distance is used.
      const sourceOnly = this.options.rearmPolicy === 'source-latched';
      const travelled = sourceOnly
        ? Math.min(levelSpeed * recoveryDt, s.recoveryRemainingNative)
        : levelSpeed * recoveryDt;
      s.recoveryRemainingNative = Math.max(0, s.recoveryRemainingNative - travelled);
      s.cooldownRemainingNative = Math.max(0, s.cooldownRemainingNative - travelled);
      if (!sourceOnly && s.cooldownRemainingNative <= 1e-9) {
        s.cooldownBlocked = false;
        events.push({ type: 'rearmed', policy: 'distance-repair' });
      }
    }
    return events;
  }
}
