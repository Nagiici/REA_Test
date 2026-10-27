import { CLASSIC_MOTION_SOURCE as SOURCE, landingRole, laneAnimationPlan, pickSourceAnimation } from './classic-motion.js';
import { mulberry32 } from './game-core.js';

/** Source event/clip policy over a replacement skeleton. Rendering clock and
 * cross-fade scheduling are browser adapters; gameplay timing stays in core. */
export class PlayerMotion {
  constructor(pools = {}) { this.pools = pools; this.state = null; }
  reset(state) {
    this.state = state; this.random = mulberry32(0x434c4153); this.token = 0;
    this.pose = null; this.air = null; this.boardPose = null; this.returnFade = .1;
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
      if (event.type === 'start' || event.type === 'revive') { this.pose = null; this.air = null; this.boardPose = null; }
      if (event.type === 'lane') {
        const plan = laneAnimationPlan({ direction: event.direction < 0 ? 'left' : 'right', grounded: p.grounded,
          jumping: p.isJumping, flying: !!state.flight, dead: state.phase === 'gameover', hoverboard: state.board.active });
        if (plan.play) {
          const normal = event.direction < 0 ? 'dodge_left' : 'dodge_right';
          const name = state.flight ? event.direction < 0 ? 'flight_left' : 'flight_right'
            : state.board.active ? event.direction < 0 ? 'board_left' : 'board_right' : this.pick(plan.play, normal);
          transient(name, plan.fade, plan.queueFade, speedRatio);
        }
      }
      if (event.type === 'jump') { this.pose = null; this.air = { name: this.pick('jump', 'jump'), token: ++this.token, fade: SOURCE.jumpFade }; }
      if (event.type === 'hangtime') { this.air = { name: this.pick('hangtime', 'jump'), token: ++this.token, fade: SOURCE.hangtimeFade }; }
      if (event.type === 'roll' || event.type === 'stumble' || event.type === 'crash') this.pose = null;
      if (event.type === 'land') {
        this.air = null;
        this.runName = this.pick('run', 'run');
        const role = landingRole(event.velocityY * 10, { rolling: event.rolling });
        if (role && role !== 'run') transient(state.board.active ? 'board_landing' : this.pick('landing', 'landing'), SOURCE.landingFade, SOURCE.landingToRunFade);
      }
      if (event.type === 'board-start') { this.boardPose = { name: 'board_takeoff', token: ++this.token, until: now + duration('board_takeoff') }; }
      if (event.type === 'board-hit') this.boardPose = null;
    }
    if (state.reaction) return { name: state.reaction.name, token: state.reaction.token,
      duration: state.reaction.duration, fade: .1 };
    if (this.pose?.until > now) return this.pose;
    this.pose = null;
    if (state.flight) return { name: 'flight' };
    if (p.rollRemaining > 0) return { name: state.board.active ? 'board_roll' : 'roll',
      token: p.rollToken, duration: state.board.active ? duration('board_roll') : duration('roll'), fade: SOURCE.rollFade };
    if (!p.grounded) return state.board.active ? { name: 'board_jump', token: this.air?.token, fade: SOURCE.jumpFade }
      : this.air ?? { name: 'jump', fade: SOURCE.jumpFade };
    if (state.board.active && this.boardPose?.until > now) return this.boardPose;
    return { name: state.board.active ? 'board_run' : this.runName, fade: this.returnFade, speed: speedRatio };
  }
}
