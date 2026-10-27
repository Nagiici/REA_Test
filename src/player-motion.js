import { CLASSIC_MOTION_SOURCE as SOURCE, jumpRole, landingRole, laneAnimationPlan, pickSourceAnimation } from './classic-motion.js';
import { mulberry32 } from './game-core.js';

/** Source event/clip policy over a replacement skeleton. Rendering clock and
 * cross-fade scheduling are browser adapters; gameplay timing stays in core. */
export class PlayerMotion {
  constructor(pools = {}) { this.pools = pools; this.state = null; }
  reset(state) {
    this.state = state; this.random = mulberry32(0x434c4153); this.token = 0;
    this.pose = null; this.air = null; this.rollPose = null; this.boardPose = null; this.returnFade = .1;
    this.airReturnRun = false;
    this.runName = this.pick('run', 'run');
  }
  pick(role, fallback) {
    const pool = this.pools[role];
    return pool?.length ? pickSourceAnimation(pool, this.random) : fallback;
  }
  select(state, events, actor) {
    if (state !== this.state) this.reset(state);
    const p = state.player, now = state.elapsed, speedRatio = state.speed / 11;
    const duration = name => actor.clipDurations?.[name] ?? .5;
    const transient = (name, fade, queueFade, speed = 1) => {
      this.pose = { name, token: ++this.token, until: now + duration(name) / speed, fade, speed };
      this.returnFade = queueFade;
    };
    for (const event of events) {
      if (event.type === 'start' || event.type === 'revive') { this.pose = null; this.air = null; this.rollPose = null; this.boardPose = null; this.airReturnRun = false; }
      if (event.type === 'lane') {
        // NotifyOnChangeTrack runs at input time. A landing in a later fixed
        // step in this render frame must not retroactively permit an air dodge.
        const context = event.motion ?? { grounded: p.grounded, jumping: p.isJumping,
          flying: !!state.flight, hoverboard: state.board.active };
        const plan = laneAnimationPlan({ direction: event.direction < 0 ? 'left' : 'right', ...context,
          dead: state.phase === 'gameover', hitMovingPlaying: state.reaction?.name === 'death_moving_train' });
        if (plan.play) {
          const normal = event.direction < 0 ? 'dodge_left' : 'dodge_right';
          const name = context.flying ? event.direction < 0 ? 'flight_left' : 'flight_right'
            : context.hoverboard ? event.direction < 0 ? 'board_left' : 'board_right' : this.pick(plan.play, normal);
          transient(name, plan.fade, plan.queueFade, context.speedNormalized ?? speedRatio);
        }
        if (plan.queue) this.runName = this.pick('run', 'run');
      }
      if (event.type === 'jump') {
        this.pose = null; this.airReturnRun = false;
        const role = jumpRole({ heightNative: event.height * 10, normalJumpHeightNative: (event.normalJumpHeight ?? 2) * 10 });
        this.air = { name: this.pick(role === 'smallJump' && !this.pools.smallJump ? 'jump' : role, 'jump'), token: ++this.token, fade: SOURCE.jumpFade };
      }
      if (event.type === 'hangtime') {
        this.pose = null; this.airReturnRun = false;
        this.air = { name: this.pick('hangtime', 'jump'), token: ++this.token, fade: SOURCE.hangtimeFade };
      }
      if (event.type === 'roll') {
        this.pose = null; this.air = null; this.airReturnRun = true;
        this.runName = this.pick('run', 'run');
        this.rollPose = { name: event.hoverboard ? 'board_roll' : 'roll', token: event.token, fade: SOURCE.rollFade };
        this.returnFade = event.hoverboard ? SOURCE.boardRollToRunFade : SOURCE.rollToRunFade;
      }
      if (event.type === 'roll-end') this.rollPose = null;
      if (event.type === 'stumble') {
        this.air = null; this.airReturnRun = true; this.runName = this.pick('run', 'run');
        const side = event.horizontal;
        const fade = side === 'RightCorner' ? .07
          : side?.startsWith('Left') || side?.startsWith('Right') || /stumble_(left|right|corner)/.test(event.animation) ? .2
          : event.vertical === 'Upper' || event.critical ? .07 : .05;
        transient(event.animation, fade, .5);
      }
      if (event.type === 'crash') this.pose = null;
      if (event.type === 'land') {
        if (event.rolling) continue;
        this.air = null;
        this.airReturnRun = false; this.returnFade = SOURCE.landingToRunFade;
        this.runName = this.pick('run', 'run');
        const role = landingRole(event.velocityY * 10, { rolling: event.rolling });
        if (role && role !== 'run') transient(state.board.active ? 'board_landing' : this.pick('landing', 'landing'), SOURCE.landingFade, SOURCE.landingToRunFade);
        else this.pose = null;
      }
      if (event.type === 'board-start') { this.boardPose = { name: 'board_takeoff', token: ++this.token, until: now + duration('board_takeoff') }; }
      if (event.type === 'board-hit') this.boardPose = null;
    }
    // A stumble clip is interruptible by later native notifications. Keeping
    // it above every jump/roll for the whole logical stumble window was wrong.
    if (state.phase === 'gameover' || state.phase === 'paused' && state.pausedFrom === 'gameover') {
      if (state.reaction) return { name: state.reaction.name, token: state.reaction.token,
        duration: state.reaction.duration, fade: state.reaction.name === 'death_moving_train' ? 0 : .2 };
    }
    if (this.pose?.until > now) return this.pose;
    this.pose = null;
    if (state.flight) return { name: 'flight' };
    if (p.rollRemaining > 0) {
      const roll = this.rollPose ?? { name: state.board.active ? 'board_roll' : 'roll', token: p.rollToken, fade: SOURCE.rollFade };
      return { ...roll, duration: duration(roll.name) };
    }
    if (!p.grounded && !this.airReturnRun) return state.board.active ? { name: 'board_jump', token: this.air?.token, fade: this.air?.fade ?? SOURCE.jumpFade }
      : this.air ?? { name: 'jump', fade: SOURCE.jumpFade };
    if (state.board.active && this.boardPose?.until > now) return this.boardPose;
    return { name: state.board.active ? 'board_run' : this.runName, fade: this.returnFade, speed: speedRatio };
  }
}
