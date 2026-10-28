/**
 * Classic/default-board native fallback, in original Unity distance units.
 * Evidence: analysis/flight/hoverboard/disassembly/605.asm and
 * analysis/classic/board-v13 (GameStats20975/20977, PlayerInfo21971).
 * Account inventory, rendering, route hiding and Character.Revive are adapters.
 */
export const HOVERBOARD_SOURCE = Object.freeze({
  duration: 30,
  cooldownSeconds: 5,
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
});

/**
 * The modifier's recovery coroutine does not own reactivation. GameStats keeps
 * the expired type-1 powerup, including negative timeLeft, until it reaches
 * -(WaitForParticlesDelay + GetHoverBoardCoolDown()), then calls HardReset.
 * Jetpack pauses that timer even when it is already negative.
 */
export class Hoverboard {
  constructor({ inventory = 3, duration = HOVERBOARD_SOURCE.duration } = {}) {
    if (!Number.isInteger(inventory) || inventory < 0 || !Number.isFinite(duration) || duration <= 0) throw new Error('Invalid hoverboard configuration');
    this.options = { inventory, duration };
    this.reset();
  }

  reset({ inventory = this.options.inventory } = {}) {
    if (!Number.isInteger(inventory) || inventory < 0) throw new Error('Invalid local inventory');
    this.state = { inventory, active: false, flying: false, timeLeft: 0,
      cooldownBlocked: false, cooldownRemainingNative: 0, recoveryRemainingNative: 0,
      crashDelay: 0, crashPending: false, deathGuardRemaining: 0 };
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
  hit({ flying = this.state.flying } = {}) {
    if (flying || !this.protects) return false;
    // Game.Die suppresses another call for .4 s, independently of board state.
    if (this.state.deathGuardRemaining > 0) return true;
    // RemoveHoverBoardPowerup20977 sets timeLeft to zero without removing it.
    Object.assign(this.state, { active: false, timeLeft: 0, cooldownBlocked: true,
      crashPending: true, crashDelay: HOVERBOARD_SOURCE.crashParticleDelay,
      deathGuardRemaining: HOVERBOARD_SOURCE.repeatedDeathGuard });
    return true;
  }

  /**
   * levelSpeed is native units/second (browser velocity / worldScale).
   * Returns [{type:'clearObstacles',distanceNative}, {type:'revive',jumpHeightNative}]
   * once after a crash; the caller implements geometry/physics and presentation.
   */
  step(dt, { levelSpeed = 0, speedNormalized = 1, pausedForFlight = false } = {}) {
    if (!Number.isFinite(dt) || dt < 0 || !Number.isFinite(levelSpeed) || levelSpeed < 0
      || !Number.isFinite(speedNormalized) || speedNormalized < 0) throw new Error('Invalid hoverboard step');
    const s = this.state, events = [];
    s.flying = pausedForFlight;
    s.deathGuardRemaining = Math.max(0, s.deathGuardRemaining - dt);
    // Collection.PauseInJetpackMode pauses the iterator; GameStats also pauses
    // type 1's timer. Resume leaves the existing board and inventory intact.
    if (pausedForFlight) return events;
    if (s.active) {
      s.timeLeft -= dt;
      if (s.timeLeft <= 0) {
        s.active = false;
        s.cooldownBlocked = true;
        events.push({ type: 'expired' });
      }
    } else if (s.cooldownBlocked) s.timeLeft -= dt;
    let recoveryDt = dt;
    if (s.crashPending) {
      recoveryDt = Math.max(0, dt - s.crashDelay);
      s.crashDelay = Math.max(0, s.crashDelay - dt);
      if (s.crashDelay > 0) return events;
      s.crashPending = false;
      // Begin605 samples current character speed AFTER the particle wait.
      const scale = speedNormalized;
      s.cooldownRemainingNative = HOVERBOARD_SOURCE.cooldownDistance * scale;
      s.recoveryRemainingNative = HOVERBOARD_SOURCE.recoveryDistance * scale;
      events.push({ type: 'clearObstacles', distanceNative: HOVERBOARD_SOURCE.obstacleClearDistance * scale });
      events.push({ type: 'revive', jumpHeightNative: HOVERBOARD_SOURCE.reviveJumpHeight });
    }
    if (s.cooldownBlocked) {
      // These distances describe the crash effect's coroutine, not eligibility.
      const travelled = Math.min(levelSpeed * recoveryDt, s.recoveryRemainingNative);
      s.recoveryRemainingNative = Math.max(0, s.recoveryRemainingNative - travelled);
      s.cooldownRemainingNative = Math.max(0, s.cooldownRemainingNative - travelled);
      const threshold = Math.fround(HOVERBOARD_SOURCE.cooldownSeconds + HOVERBOARD_SOURCE.crashParticleDelay);
      if (s.timeLeft <= -threshold) {
        s.cooldownBlocked = false;
        s.timeLeft = 0; s.cooldownRemainingNative = 0; s.recoveryRemainingNative = 0;
        events.push({ type: 'rearmed', policy: 'source-timer' });
      }
    }
    return events;
  }
}
