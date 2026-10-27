/**
 * Classic Game.Intro fallback timing and event order.
 * Evidence: analysis/classic/intro-v3/findings.json, methods 36732/36481/50809.
 * This does not sample the source startPan/introRun animation tracks, render
 * effects, move gameplay entities, or reconstruct account/UI startup work.
 */
export const CLASSIC_INTRO_SOURCE = Object.freeze({
  animationFade: 0.20000000298023224,
  queuedRunFade: 0.20000000298023224,
  fovProgressPerSecond: 0.75,
  cameraAnimationName: 'startPan',
  playerIntroIndex: 0,
});

/** Native Intro captures camera FOV and RunningState.cameraFOV/aspect once.
 * Completion force-writes the target, even if the intro clip ends before the
 * 1/.75-second FOV interpolation would finish. Screen resize policy is external.
 */
export function sampleIntroFov(elapsed, { startFov, runningFov, aspect, complete = false }) {
  nonnegative(elapsed, 'elapsed');
  positive(startFov, 'startFov');
  positive(runningFov, 'runningFov');
  positive(aspect, 'aspect');
  const target = runningFov / aspect;
  if (complete) return target;
  const t = Math.min(1, elapsed * CLASSIC_INTRO_SOURCE.fovProgressPerSecond);
  return startFov + (target - startFov) * t;
}

/** Menu -> source animation intro -> RunningState.
 * Supply the recovered player's raw intro AnimationState.length, not a guessed
 * fixed delay, guard clip duration, camera duration, or length/playbackSpeed.
 * Ordinary Game.ChangeState(null, Intro) leaves CharacterState null, so gameplay
 * swipes/taps are ignored until the running event. No input is buffered here.
 * There is no source-derived skip action in this helper.
 */
export class SourceClassicIntro {
  constructor({ introDuration, startFov, runningFov, aspect }) {
    positive(introDuration, 'introDuration');
    positive(startFov, 'startFov');
    positive(runningFov, 'runningFov');
    positive(aspect, 'aspect');
    this.duration = introDuration;
    this.camera = Object.freeze({ startFov, runningFov, aspect });
    this.reset();
  }

  reset() {
    this.phase = 'menu';
    this.elapsed = 0;
    return this.sample();
  }

  begin() {
    if (this.phase !== 'menu') return { ...this.sample(), started: false, events: [] };
    this.phase = 'intro';
    // Actual source startup also resets stats/modifiers and initializes assets.
    // Integration owns those operations; the ordered cues describe presentation.
    return { ...this.sample(), started: true, events: [
      { type: 'stage-menu', playerNativePosition: [0, 0, 0], guardFollowEnabled: false },
      { type: 'guard-intro', guardVisible: true, guardRootNativePosition: [0, 0, -10],
        queue: 'run', queueFade: CLASSIC_INTRO_SOURCE.queuedRunFade },
      { type: 'camera-intro', animation: CLASSIC_INTRO_SOURCE.cameraAnimationName,
        fade: CLASSIC_INTRO_SOURCE.animationFade },
      { type: 'player-intro', role: 'introRun', index: CLASSIC_INTRO_SOURCE.playerIntroIndex,
        fade: CLASSIC_INTRO_SOURCE.animationFade },
      { type: 'intro-run', stopKillParticles: true, sprayCanVisible: false,
        eyeAnimationsEnabled: false, queue: 'run', queueFade: CLASSIC_INTRO_SOURCE.queuedRunFade },
    ] };
  }

  sample() {
    const complete = this.phase === 'running';
    return { phase: this.phase, elapsed: this.elapsed, duration: this.duration,
      normalizedTime: this.elapsed / this.duration,
      allowInput: complete, complete,
      cameraFov: sampleIntroFov(this.elapsed, { ...this.camera, complete }) };
  }

  step(dt, { paused = false } = {}) {
    nonnegative(dt, 'delta time');
    let finished = false;
    if (!paused && this.phase === 'intro') {
      this.elapsed = Math.min(this.duration, this.elapsed + dt);
      if (this.elapsed >= this.duration) {
        this.phase = 'running';
        finished = true;
      }
    }
    return { ...this.sample(), finished, events: finished ? [
      { type: 'running', resetStats: true, guardFollowEnabled: true, allowInput: true },
    ] : [] };
  }
}

function positive(value, name) {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`Invalid intro ${name}`);
}

function nonnegative(value, name) {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`Invalid intro ${name}`);
}
