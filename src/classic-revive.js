/**
 * Local classic SaveMe flow. Native evidence lives in
 * analysis/classic/revive/findings.json; account/payment eligibility is excluded.
 */
export const CLASSIC_REVIVE_SOURCE = Object.freeze({
  offerSeconds: 8, // NormalModeSaveMePopup.<startClockAnimation>d__93, 0x155c818.
  delaySeconds: 0.14399999380111694, // Revive component c3dd...:2322.
  clearDistanceNative: 250,
  jumpHeightNative: 15,
});

export class ClassicRevive {
  constructor({ localCredits = 1 } = {}) {
    if (!Number.isInteger(localCredits) || localCredits < 0) throw new RangeError('Invalid local revive credits');
    // One credit is a browser demo policy, never a recovered account allowance.
    this.localCredits = localCredits;
    this.reset();
  }

  reset() {
    this.state = { phase: 'idle', credits: this.localCredits, used: 0, offerRemaining: 0, delayRemaining: 0 };
    return this.state;
  }

  offer() {
    if (!['idle', 'resumed'].includes(this.state.phase) || this.state.credits === 0) return false;
    this.state.phase = 'offered';
    this.state.offerRemaining = CLASSIC_REVIVE_SOURCE.offerSeconds;
    this.state.delayRemaining = 0;
    return true;
  }

  accept() {
    const s = this.state;
    if (s.phase !== 'offered' || s.offerRemaining <= 0 || s.credits === 0) return false;
    s.phase = 'reviving';
    s.credits--;
    s.used++;
    s.offerRemaining = 0;
    s.delayRemaining = CLASSIC_REVIVE_SOURCE.delaySeconds;
    return true;
  }

  decline() {
    if (this.state.phase !== 'offered') return false;
    this.state.phase = 'finished';
    this.state.offerRemaining = 0;
    return true;
  }

  /**
   * UI flow only. Caller keeps world distance/score fixed during the offer,
   * while advancing native powerup timers and the level-speed clock unless
   * explicitly paused. Caller handles clearing and physics on `resume`.
   */
  step(dt, { paused = false } = {}) {
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Invalid revive delta time');
    if (paused) return [];
    const s = this.state;
    if (s.phase === 'offered') {
      s.offerRemaining = Math.max(0, s.offerRemaining - dt);
      if (s.offerRemaining <= 1e-9) {
        s.offerRemaining = 0;
        s.phase = 'finished';
        return [{ type: 'offer-expired' }];
      }
    } else if (s.phase === 'reviving') {
      s.delayRemaining = Math.max(0, s.delayRemaining - dt);
      if (s.delayRemaining <= 1e-9) {
        s.delayRemaining = 0;
        s.phase = 'resumed';
        return [{ type: 'resume', clearDistanceNative: CLASSIC_REVIVE_SOURCE.clearDistanceNative,
          jumpHeightNative: CLASSIC_REVIVE_SOURCE.jumpHeightNative }];
      }
    }
    return [];
  }
}
