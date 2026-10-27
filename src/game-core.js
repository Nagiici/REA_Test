import { ClassicCollisionState } from './classic-collision.js';
import { ClassicRevive } from './classic-revive.js';
import { resolveClassicImpact } from './classic-impact.js';
import { runnerEntityContact } from './classic-contact.js';
import { classicVerticalMotion } from './classic-vertical.js';
import { Jetpack } from './jetpack.js';
import { makeFlightCoins } from './flight-coins.js';
import { Hoverboard, HOVERBOARD_BROWSER_ADAPTER } from './hoverboard.js';
import { DEFAULT_CONFIG } from './config.js';
import { SourceClassicIntro } from './classic-intro.js';
import { SourceRollTimeline, runningTransitionFromHeight, rollVerticalSpeed } from './classic-motion.js';
import { POWERUP_SECONDS, POWERUP_NAMES, SNEAKERS, touchesPowerup } from './powerups.js';

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

/** The vertical line through a runner intersects the original rotated collider. */
export function sourceVerticalBounds(entity, x, distance) {
  const shape = entity.sourceShape;
  if (!shape) return { bottom: entity.bottom ?? 0, top: entity.height };
  const origin = shape.rows.map(row => row[0] * (x - entity.x) + row[2] * (distance - entity.distance) + row[3]);
  const direction = shape.rows.map(row => row[1]);
  if (shape.type === 'box') {
    let bottom = -Infinity, top = Infinity;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(direction[i]) < 1e-12) { if (Math.abs(origin[i]) > shape.halfSize[i] + 1e-8) return null; continue; }
      const a = (-shape.halfSize[i] - origin[i]) / direction[i], b = (shape.halfSize[i] - origin[i]) / direction[i];
      bottom = Math.max(bottom, Math.min(a, b)); top = Math.min(top, Math.max(a, b));
    }
    return top >= bottom ? { bottom, top } : null;
  }
  if (shape.type === 'capsule') {
    const { axis, radius, halfSegment } = shape;
    const roots = [];
    function solve(a, b, c, valid) {
      const discriminant = b * b - 4 * a * c;
      if (a < 1e-16 || discriminant < 0) return;
      for (const t of [(-b - Math.sqrt(discriminant)) / (2 * a), (-b + Math.sqrt(discriminant)) / (2 * a)]) if (valid(t)) roots.push(t);
    }
    const perp = [0, 1, 2].filter(i => i !== axis);
    solve(perp.reduce((sum, i) => sum + direction[i] ** 2, 0), 2 * perp.reduce((sum, i) => sum + origin[i] * direction[i], 0), perp.reduce((sum, i) => sum + origin[i] ** 2, 0) - radius ** 2, t => Math.abs(origin[axis] + direction[axis] * t) <= halfSegment + 1e-8);
    for (const sign of [-1, 1]) {
      const capOrigin = origin.map((value, i) => value - (i === axis ? sign * halfSegment : 0));
      solve(direction.reduce((sum, value) => sum + value ** 2, 0), 2 * capOrigin.reduce((sum, value, i) => sum + value * direction[i], 0), capOrigin.reduce((sum, value) => sum + value ** 2, 0) - radius ** 2, t => sign * (origin[axis] + direction[axis] * t) >= halfSegment - 1e-8);
    }
    return roots.length >= 2 ? { bottom: Math.min(...roots), top: Math.max(...roots) } : null;
  }
  throw new Error(`Unknown collider shape: ${shape.type}`);
}

export function mulberry32(seed) {
  return () => {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/** Pure deterministic simulation; DOM and Three.js stay outside this module. */
export class RunnerGame {
  constructor(config = {}, routeLibrary = []) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.routeLibrary = routeLibrary;
    this.routeGenerator = null;
    this.reset();
  }

  setRouteGenerator(generator) {
    if (!generator || typeof generator.nextChunk !== 'function' || typeof generator.reset !== 'function') throw new Error('Route generator must implement reset(seed) and nextChunk(context)');
    this.routeGenerator = generator;
    this.reset();
  }

  reset(seed = this.config.seed) {
    this.random = mulberry32(seed);
    this.routeGenerator?.reset(seed);
    this.routeTrace = [];
    this.accumulator = 0;
    this.realtime = 0;
    this.nextId = 0;
    this.events = [];
    this.entities = [];
    this.nextSection = this.routeGenerator?.initialDistance ?? 28;
    this.sectionCount = 0;
    this.state = {
      phase: 'ready', intro: null, distance: 0, coins: 0, score: 0,
      baseScore: 0, scoredMeters: 0, powerups: {},
      speed: this.config.initialSpeed, elapsed: 0,
      player: { lane: 1, x: 0, y: 0, velocityY: 0, rollRemaining: 0, rollToken: 0,
        isJumping: false, isFalling: false, lastGroundedY: 0, inAirJump: false, jumpHeight: this.config.jumpHeight,
        transitionFromHeight: false, canAccelerateForward: true,
        grounded: true, floor: 0, laneFrom: 0, laneElapsed: 0, laneDuration: 0 },
      collision: null, reaction: null, pausedFrom: null, catchRemaining: 0, deathGrounding: null,
    };
    this.jetpack = new Jetpack({ tier: clamp(Math.floor(this.config.powerupTier), 0, 6) });
    this.hoverboard = new Hoverboard(HOVERBOARD_BROWSER_ADAPTER);
    this.state.levelSpeed = this.config.initialSpeed;
    this.state.flight = null;
    this.state.board = this.hoverboard.state;
    this.revival = new ClassicRevive({ localCredits: this.config.localRevives });
    this.state.revival = this.revival.state;
    this.reactionSerial = 0;
    this.rollTimeline = new SourceRollTimeline();
    this.rollAnimation = null;
    this.lastStumbleContact = null;
    this.contacts = new Set();
    this.ceiling = { hit: false, minY: 0, evaded: false };
    this.lastFixedPosition = [0, 0, 0];
    this.previousFixedPosition = [0, 0, 0];
    this.collisionState = new ClassicCollisionState();
    this.state.stumble = this.collisionState.snapshot();
    this.ensureCourse();
  }

  start() {
    if (!['ready', 'gameover'].includes(this.state.phase) || this.state.catchRemaining > 0 || this.state.deathGrounding) return;
    if (this.state.phase === 'gameover') this.reset();
    if (this.introOptions) {
      this.intro = new SourceClassicIntro(this.introOptions);
      this.state.intro = this.intro.begin();
      this.state.phase = 'intro';
      this.state.stumble = this.collisionState.beginIntro();
      this.events.push(...this.state.intro.events);
      return;
    }
    this.state.phase = 'running';
    this.events.push({ type: 'start' });
    if (this.headstartOnStart) this.activateHeadstart();
  }

  pause() {
    const s = this.state;
    if (s.phase === 'intro' || s.phase === 'running' || s.phase === 'reviving' || s.phase === 'gameover' && (this.revival.state.phase === 'offered' || s.catchRemaining > 0 || s.deathGrounding)) { s.pausedFrom = s.phase; s.phase = 'paused'; }
    else if (s.phase === 'paused') { s.phase = s.pausedFrom ?? 'running'; s.pausedFrom = null; }
    this.accumulator = 0;
  }

  action(action) {
    if (this.state.phase !== 'running') return false;
    const p = this.state.player;
    if (action === 'turbo') {
      if (!this.jetpack.turbo()) return false;
      this.state.flight = this.jetpack.snapshot();
      this.events.push({ type: 'turbo-headstart', tier: this.state.flight.headstartTier });
      return true;
    }
    if (action === 'board') {
      const activated = this.hoverboard.activate({ flying: !!this.state.flight });
      if (activated) this.events.push({ type: 'board-start', motion: { jumping: p.isJumping, falling: p.isFalling } });
      return activated;
    }
    if (this.state.flight && !['left', 'right'].includes(action)) return false;
    if (action === 'left' || action === 'right') {
      const next = clamp(p.lane + (action === 'left' ? -1 : 1), 0, 2);
      if (next === p.lane) {
        if (!this.state.flight) this.stumble(action === 'left' ? 'stumble_left' : 'stumble_right', action === 'left' ? .416667 : .833334);
        return false;
      }
      p.laneOrigin = p.lane;
      p.laneFrom = p.x;
      p.laneElapsed = 0;
      p.laneDuration = Math.abs((next - 1) - p.x / this.config.laneSpacing) * this.laneChangeSeconds;
      p.lane = next;
      this.events.push({ type: 'lane', lane: next, direction: action === 'left' ? -1 : 1, duration: p.laneDuration,
        motion: { grounded: p.grounded, jumping: p.isJumping, flying: !!this.state.flight,
          hoverboard: this.state.board.active, speedNormalized: this.state.speed / 11 } });
      return true;
    }
    // Character.Jump 81949 accepts a brief step-off while not already jumping.
    // A downward airborne request is retained until CheckInAirJump sees ground.
    if (action === 'jump' && !(p.grounded || !p.isJumping && p.velocityY <= 0 && p.velocityY > -3)) {
      if (p.velocityY < 0) p.inAirJump = true;
      return false;
    }
    if (action === 'jump') {
      this.endRoll('jump');
      if (p.isJumping && this.ceiling.evaded) this.ceiling.hit = false;
      p.inAirJump = false; p.isJumping = true; p.isFalling = false;
      p.jumpHeight = this.state.powerups.sneakers > 0 ? SNEAKERS.height : this.config.jumpHeight;
      p.velocityY = Math.sqrt(2 * this.config.gravity * this.config.jumpHeight);
      p.grounded = false;
      if (this.state.powerups.sneakers > 0) {
        p.velocityY = 0;
        p.sneakersJump = { startY: p.y, startDistance: this.state.distance,
          length: 2 * this.state.speed * Math.sqrt(2 * SNEAKERS.height * this.config.gravity) / this.config.gravity * SNEAKERS.apexRatio };
      }
      this.events.push({ type: 'jump', height: p.jumpHeight, normalJumpHeight: this.config.jumpHeight });
      return true;
    }
    if (action === 'roll') {
      // HandleSwipe's route-height override runs even if Character.Roll early
      // returns. Route local Y is distinct from floor/roof or lastGroundedY.
      const routeY = this.routeGenerator?.relativePosition
        ? this.routeGenerator.relativePosition([p.x, p.y, this.state.distance], { end: this.nextSection })?.[1]
        : null; // No native Route context: do not invent a high-air override.
      const highAirSpeed = routeY > 20 ? -Math.sqrt(2 * this.config.gravity * routeY) : null;
      if (p.rollRemaining > 0) {
        if (highAirSpeed !== null) p.velocityY = highAirSpeed;
        return false;
      }
      p.sneakersJump = null;
      p.inAirJump = false;
      p.velocityY = rollVerticalSpeed({ gravityNative: this.config.gravity * 10, jumpHeightNative: p.jumpHeight * 10,
        transitionFromHeight: p.transitionFromHeight,
        routeRelativeHeightNative: Number.isFinite(routeY) ? routeY * 10 : null }) * .1;
      p.rollRemaining = this.state.board.active ? this.config.boardRollSeconds : this.config.rollSeconds;
      p.rollToken++;
      this.rollTimeline.begin(p.rollRemaining); this.rollAnimation = null;
      this.events.push({ type: 'roll', token: p.rollToken, hoverboard: this.state.board.active });
      return true;
    }
    return false;
  }

  get laneChangeSeconds() {
    return this.state.flight ? 6 / this.state.speed
      : this.config.laneChangeSeconds ?? this.config.laneChangeDistance / this.state.speed;
  }

  /** Renderer feedback is queued and consumed only at the next fixed step.
   * A stale outgoing action cannot terminate a newer accepted roll. */
  updateAnimationState(snapshot) {
    const roll = snapshot?.roll, p = this.state.player;
    if (p.rollRemaining > 0 && roll?.token === p.rollToken && typeof roll.enabled === 'boolean')
      this.rollAnimation = { token: roll.token, enabled: roll.enabled, rawLength: roll.rawLength };
  }

  endRoll(reason) {
    const p = this.state.player, active = p.rollRemaining > 0;
    p.rollRemaining = 0; this.rollTimeline.active = false; this.rollAnimation = null;
    if (active) this.events.push({ type: 'roll-end', token: p.rollToken, reason });
  }

  enterRunningFromHeight() {
    const p = this.state.player;
    p.transitionFromHeight = runningTransitionFromHeight(p.y * 10);
    p.lastGroundedY = p.y; // Running.Begin sets this even while still airborne.
  }

  get hasActiveClock() {
    return this.state.phase === 'intro' || this.state.phase === 'running' || this.state.phase === 'reviving'
      || this.state.phase === 'gameover' && (this.revival.state.phase === 'offered' || this.state.catchRemaining > 0 || !!this.state.deathGrounding);
  }

  advance(seconds, { realtimeDelta = seconds } = {}) {
    // Source grounding timeout uses realtimeSinceStartup; physics and all
    // animation remain paused. A timeout is acted upon only after resuming.
    if (Number.isFinite(realtimeDelta)) this.realtime += Math.max(0, realtimeDelta);
    if (!this.hasActiveClock) return;
    this.accumulator += clamp(seconds, 0, 0.1);
    const dt = this.config.fixedStep;
    while (this.accumulator + 1e-10 >= dt && this.hasActiveClock) {
      if (this.state.phase === 'intro') {
        this.state.stumble = this.collisionState.step(dt, { running: false });
        this.state.intro = this.intro.step(dt);
        if (this.state.intro.finished) {
          this.state.phase = 'running';
          this.events.push(...this.state.intro.events, { type: 'start' });
          if (this.headstartOnStart) this.activateHeadstart();
        }
      }
      else if (this.state.phase === 'running') this.step(dt);
      else this.stepRevival(dt);
      this.accumulator -= dt;
    }
  }

  updatePowerupTimes(dt) {
    const s = this.state;
    for (const type of Object.keys(s.powerups)) {
      if (type === 'jetpack' || type === 'sneakers' && s.flight) continue;
      s.powerups[type] = Math.max(0, s.powerups[type] - dt);
      if (s.powerups[type] <= 1e-8) { delete s.powerups[type]; this.events.push({ type: 'powerup-end', powerup: type }); }
    }
  }

  revive() {
    if (this.state.phase !== 'gameover' || !this.revival.accept()) return false;
    this.state.phase = 'reviving';
    this.events.push({ type: 'revive-start' });
    return true;
  }

  stepRevival(dt) {
    const s = this.state, p = s.player, c = this.config;
    // Native LogicUpdate advances the level clock and effect countdowns during
    // SaveMe; it freezes movement, score and the modifier coroutine iterator.
    s.elapsed += dt;
    s.levelSpeed = Math.min(c.maximumSpeed, s.levelSpeed + c.acceleration * dt);
    s.speed = s.levelSpeed;
    this.updatePowerupTimes(dt);
    this.stepTrainAutopilot(dt);
    if (s.deathGrounding) {
      const waiting = s.deathGrounding;
      if (p.grounded || this.realtime >= waiting.deadline) {
        s.deathGroundingResult = p.grounded ? 'grounded' : 'timeout';
        s.deathGrounding = null;
        if (!s.catchRemaining) this.revival.offer();
      } else {
        const previousY = p.y;
        p.sneakersJump = null;
        // Character.MoveWithGravity81955 cancels upward momentum and moves
        // only Y. Source CharacterController contact is adapted to our floor.
        p.velocityY = Math.min(p.velocityY - c.gravity * dt, 0);
        p.y += p.velocityY * dt;
        const floor = this.surfaceHeight(s.distance, p.x, previousY);
        if (p.y <= floor) {
          p.y = floor; p.velocityY = 0; p.grounded = true;
          p.lastGroundedY = floor;
        }
      }
      return; // DieSequence's presentation wait starts on the following step.
    }
    if (s.catchRemaining > 0) {
      s.catchRemaining = Math.max(0, s.catchRemaining - dt);
      if (s.catchRemaining < 1e-8) { s.catchRemaining = 0; this.revival.offer(); }
      return;
    }
    for (const event of this.revival.step(dt)) {
      if (event.type === 'resume') {
        this.clearObstacles(s.distance - c.playerRadius, s.distance + event.clearDistanceNative * .1 * s.speed / 11);
        this.hoverboard.reset({ inventory: this.hoverboard.state.inventory });
        s.board = this.hoverboard.state;
        this.collisionState.stopStumble();
        s.stumble = this.collisionState.snapshot();
        this.contacts.clear(); this.lastStumbleContact = null;
        // The native Revive launch is retained. Moving a browser gap fall to
        // the cleared floor is an explicit coordinate/geometry adapter.
        p.y = Math.max(0, p.y); p.velocityY = Math.sqrt(2 * c.gravity * event.jumpHeightNative * .1);
        p.canAccelerateForward = true;
        this.endRoll('revive');
        p.grounded = false; p.isJumping = true; p.inAirJump = false; p.sneakersJump = null;
        p.laneFrom = p.x; p.laneElapsed = 0;
        p.laneDuration = Math.abs((p.lane - 1) - p.x / c.laneSpacing) * this.laneChangeSeconds;
        s.collision = null; s.reaction = null; s.phase = 'running';
        this.events.push({ type: 'revive' });
      } else this.events.push(event);
    }
  }

  setReaction(name, duration) {
    this.state.reaction = { name, remaining: duration, duration, token: ++this.reactionSerial };
  }

  stumble(name = 'stumble_mix', duration = .833334, options = {}) {
    const outcome = this.collisionState.stumble({ ...options, flying: !!this.state.flight, running: this.state.phase === 'running' });
    this.state.stumble = this.collisionState.snapshot();
    if (outcome.stumbled) {
      if (!options.bush) this.lastStumbleContact = { entity: options.collider ?? null, at: this.state.elapsed };
      this.setReaction(name, duration); this.events.push({ type: 'stumble', animation: name, reason: outcome.reason,
        horizontal: options.horizontal, vertical: options.vertical, critical: options.animationCritical }); }
    if (outcome.fatal) this.fatalHit({ type: 'critical-hit' });
    return outcome;
  }

  fatalHit(entity, animation = 'death_bounce') {
    if (this.protectWithBoard()) return false;
    const s = this.state;
    if (s.phase === 'gameover') return true;
    s.phase = 'gameover';
    s.collision = { id: entity.id, type: entity.type, distance: s.distance };
    this.setReaction(animation, undefined);
    // Game's constructor defaults waitTimeBeforeScreen to 3 seconds, and
    // OnCatchPlayer writes the same serialized reviveWaitTime. The browser
    // uses this configured presentation window for its local revive UI;
    // native popup queue/input scheduling is not reproduced exactly.
    s.catchRemaining = this.config.catchPresentationSeconds ?? 0;
    s.deathGrounding = s.player.grounded ? null : { deadline: this.realtime + 5 };
    this.activateTrainAutopilot();
    if (!s.catchRemaining && !s.deathGrounding) this.revival.offer();
    this.events.push({ type: 'crash', obstacle: entity.type, animation });
    return true;
  }

  activateTrainAutopilot() {
    const groups = new Set();
    for (const e of this.entities) {
      // MovingTrain.ActivateAutoPilot uses the static collision proxy's near
      // face, without a lower distance bound. Visual children share motionId.
      if (e.movingTrainProxy && e.distance - e.depth / 2 - this.state.distance < 20) {
        e.collisionDisabled = true; groups.add(e.movingTrainProxy.motionId);
      }
    }
    for (const e of this.entities) if (groups.has(e.motionId)) e.trainAutopilot = true;
  }

  stepTrainAutopilot(dt) {
    for (const e of this.entities) if (e.trainAutopilot && e.movingTrain)
      e.distance -= this.state.speed * e.movingTrain.ratio * dt;
  }

  step(dt) {
    const s = this.state, p = s.player, c = this.config;
    const previousDistance = s.distance, previousX = p.x;
    this.previousFixedPosition = this.lastFixedPosition;
    this.lastFixedPosition = [p.x, p.y, s.distance];
    const stumble = this.collisionState.step(dt, { flying: !!s.flight });
    s.stumble = this.collisionState.snapshot();
    if (s.reaction?.remaining != null) { s.reaction.remaining -= dt; if (s.reaction.remaining <= 0) s.reaction = null; }
    if (stumble.fatal && this.fatalHit({ type: 'repeated-stumble' }, 'caught_fall')) return;
    const nextContacts = new Set();
    this.updatePowerupTimes(dt);
    s.elapsed += dt;
    s.levelSpeed = Math.min(c.maximumSpeed, s.levelSpeed + c.acceleration * dt);
    if (s.flight) {
      const oldTarget = s.flight.targetZ;
      let flight = this.jetpack.step(dt, { distance: previousDistance });
      if (flight.active && flight.headstart && flight.targetZ !== oldTarget) {
        const target = this.routeGenerator?.scheduleJetpackLanding?.(flight.targetZ, this.nextSection,
          c.maximumSpeed * Math.sqrt(2 * 12 / c.gravity) + c.playerRadius + c.maximumSpeed * dt * 2);
        if (target != null) flight = this.jetpack.extendTarget(target);
      }
      if (!flight.active) {
        if (flight.headstart) {
          // ChangeCurrentSpeed advances speed-ramp age by rampDuration*ratio.
          s.levelSpeed = Math.min(c.maximumSpeed, s.levelSpeed + (c.maximumSpeed - c.initialSpeed) * flight.speedAgeRatio);
          this.events.push({ type: 'headstart-end' });
        }
        s.flight = null; delete s.powerups.jetpack; p.velocityY = 0;
        this.enterRunningFromHeight();
        this.events.push({ type: 'powerup-end', powerup: 'jetpack', motion: { hoverboard: s.board.active } });
      } else { s.flight = flight; s.powerups.jetpack = Math.max(0, flight.timeLeft); }
    }
    s.speed = s.flight ? s.flight.speed : s.levelSpeed;
    for (const event of this.hoverboard.step(dt, { levelSpeed: s.levelSpeed / 0.1, pausedForFlight: !!s.flight })) {
      if (event.type === 'clearObstacles') {
        const end = s.distance + event.distanceNative * 0.1;
        this.clearObstacles(s.distance - 2, end);
      }
      if (event.type === 'revive') {
        this.collisionState.stopStumble(); s.stumble = this.collisionState.snapshot();
        s.reaction = null; this.contacts.clear(); this.lastStumbleContact = null;
        // Browser gap recovery: removed gap geometry supplies a safe floor.
        p.y = Math.max(0, p.y); p.velocityY = Math.sqrt(2 * c.gravity * event.jumpHeightNative * 0.1);
        p.canAccelerateForward = true;
        this.endRoll('board-revive');
        p.grounded = false; p.isJumping = true; p.inAirJump = false; p.sneakersJump = null;
      }
      this.events.push({ ...event, type: `board-${event.type}` });
    }
    s.distance += s.speed * dt;
    for (const entity of this.entities) {
      entity.previousDistance = entity.distance;
      if (entity.trainAutopilot && entity.movingTrain) entity.distance -= s.speed * entity.movingTrain.ratio * dt;
      else if (entity.movingTrain) entity.distance = entity.movingTrain.initialDistance - (s.distance - entity.movingTrain.referencePlayerDistance) * entity.movingTrain.ratio;
      else if (entity.velocityZ) entity.distance -= entity.velocityZ * dt;
    }
    p.laneElapsed += dt;
    const blend = clamp(p.laneElapsed / Math.max(dt, p.laneDuration), 0, 1);
    p.x = p.laneFrom + ((p.lane - 1) * c.laneSpacing - p.laneFrom) * blend;
    if (p.rollRemaining > 0) {
      const feedback = this.rollAnimation;
      if (Number.isFinite(feedback?.rawLength) && feedback.rawLength > 0) this.rollTimeline.length = feedback.rawLength;
      if (this.rollTimeline.step(dt, { enabled: feedback?.enabled ?? true }))
        this.endRoll(feedback?.enabled === false ? 'animation-disabled' : 'clip-length');
      else p.rollRemaining = Math.max(0, this.rollTimeline.length - this.rollTimeline.elapsed);
    }
    const previousY = p.y;
    if (s.flight) {
      p.y = s.flight.y; p.velocityY = 0; p.grounded = false;
    } else {
      p.velocityY -= c.gravity * dt;
      const motion = classicVerticalMotion({ y: p.y, velocityY: p.velocityY, dt, gravity: c.gravity,
        jumping: p.isJumping, ceiling: this.ceiling,
        triggerMaxY: p.y + (p.rollRemaining > 0 ? c.rollingBottom + c.rollingHeight : c.standingBottom + c.standingHeight),
        sneakersJump: p.sneakersJump, oldDistance: previousDistance, nextDistance: s.distance });
      p.y += motion.dy; p.velocityY = motion.velocityY; p.sneakersJump = motion.sneakersJump;
      this.ceiling = motion.ceiling;
    }
    const floor = this.surfaceHeight(s.distance, p.x, previousY);
    if (!s.flight && p.y <= floor && p.velocityY <= 0) {
      if (!p.grounded) this.events.push({ type: 'land', velocityY: p.velocityY, rolling: p.rollRemaining > 0 });
      p.y = floor;
      p.velocityY = 0;
      p.grounded = true;
      p.isJumping = false; p.isFalling = false; p.lastGroundedY = floor; p.transitionFromHeight = false;
      this.ceiling = { hit: false, minY: 0, evaded: true };
      if (p.inAirJump) this.action('jump');
    } else p.grounded = false;
    p.floor = floor;
    if (!s.flight && !p.grounded && !p.isFalling && p.rollRemaining <= 0 && p.velocityY < -1) {
      p.isFalling = true; this.events.push({ type: 'hangtime' });
    }

    // Score only new whole meters with the multiplier active at that instant.
    // Enabling 2x must never retroactively double the distance already run.
    const meters = Math.floor(s.distance / c.distancePerMeter);
    s.baseScore += Math.max(0, meters - s.scoredMeters) * this.scoreMultiplier;
    s.scoredMeters = meters;

    for (const e of this.entities) {
      if (e.collected) continue;
      const x = e.x ?? (e.lane - 1) * c.laneSpacing;
      const longitudinal = e.distance - s.distance;
      if (e.type === 'powerup') {
        if (s.flight) continue;
        if (touchesPowerup(e, p, s.distance, previousDistance) && this.activatePowerup(e.powerup)) e.collected = true;
        continue;
      }
      if (e.type === 'coin') {
        if (s.flight?.takingOff) continue;
        this.attractCoin(e);
        if (e.attraction) {
          const flight = e.attraction;
          const t = Math.min(1, (s.elapsed - flight.started) / flight.duration), ease = t * t;
          // The source target is a character attachment. A stable body-space
          // target adapts it to the replacement character (not an APK bone).
          e.x = flight.x + (p.x - flight.x) * ease;
          e.y = flight.y + (p.y + 0.8 - flight.y) * ease;
          e.distance = flight.distance + (s.distance - flight.distance) * ease;
          if (t >= 1) this.collectCoin(e);
          continue;
        }
        const center = p.y + (s.flight ? 0.5 : p.rollRemaining > 0 ? 0.4 : 1);
        if (Math.abs(longitudinal) < 0.72 && Math.abs(x - p.x) < 0.7 && Math.abs((e.y ?? 1.1) - center) < 1) {
          this.collectCoin(e);
        }
        continue;
      }
      if (s.flight) continue;
      if (e.collisionDisabled || e.type === 'ramp' || e.type === 'decoration' || e.type === 'gap') continue;
      const halfDepth = e.depth / 2 + c.playerRadius;
      const oldRelative = (e.previousDistance ?? e.distance) - previousDistance - c.triggerForwardOffset;
      const newRelative = e.distance - s.distance - c.triggerForwardOffset;
      const sweptZ = Math.max(oldRelative, newRelative) >= -halfDepth && Math.min(oldRelative, newRelative) <= halfDepth;
      const sweptX = Math.max(previousX, p.x) + c.playerRadius >= x - e.width / 2
        && Math.min(previousX, p.x) - c.playerRadius <= x + e.width / 2;
      const triggerHeight = p.rollRemaining > 0 ? c.rollingHeight : c.standingHeight;
      const triggerOffset = p.rollRemaining > 0 ? c.rollingBottom : c.standingBottom;
      if (!sweptZ || !sweptX || Math.max(previousY, p.y) + triggerOffset + triggerHeight < (e.bottom ?? 0)
        || Math.min(previousY, p.y) + triggerOffset > e.height) continue;
      const contact = runnerEntityContact([previousX, previousY, previousDistance], [p.x, p.y, s.distance],
        { ...e, x }, p.rollRemaining > 0, c);
      if (contact) {
        const [contactX, contactY, contactZ] = contact.position, obstacle = contact.entity;
        const triggerBottom = contactY + triggerOffset, playerTop = triggerBottom + triggerHeight;
        if (contact.overlapping) nextContacts.add(e.id);
        if (this.contacts.has(e.id)) continue;
        // A radius-expanded train front overlaps the last part of an adjoining
        // ramp. That shared walkable seam is not a vertical wall. Only waive
        // the front contact while grounded on the matching supporting ramp;
        // the same train remains solid for a runner approaching from the ground.
        if (e.type === 'train' && this.isCrossingRampSeam(e)) continue;
        if (e.sourceLayer === 'Default' || e.sourceLayer === 'Unremovable') continue;
        if (!e.sourceIsTrigger && this.lastStumbleContact?.entity && s.elapsed - this.lastStumbleContact.at <= 1 && e.id !== this.lastStumbleContact.entity.id) {
          const prior = this.lastStumbleContact.entity; this.lastStumbleContact = null;
          if (this.fatalHit(prior)) break;
        }
        const targetX = (p.lane - 1) * c.laneSpacing;
        const trackMovement = Math.abs(targetX - p.x) < 1e-7 ? 0 : Math.sign(targetX - p.x);
        const resolved = resolveClassicImpact({
          obstacleBounds: { min: [x - e.width / 2, e.bottom ?? 0, obstacle.distance - e.depth / 2], max: [x + e.width / 2, e.height, obstacle.distance + e.depth / 2] },
          characterBounds: { min: [contactX - c.playerRadius, triggerBottom, contactZ + c.triggerForwardOffset - c.playerRadius], max: [contactX + c.playerRadius, playerTop, contactZ + c.triggerForwardOffset + c.playerRadius] },
          position: contact.position, unitScale: .1, trackMovement,
          jumping: p.isJumping, grounded: p.grounded, ceiling: this.ceiling,
          lastFixedPosition: this.lastFixedPosition, previousFixedPosition: this.previousFixedPosition,
          obstacleTag: e.sourceTag ?? (e.movingTrain || e.velocityZ ? 'HitMovingTrain' : ''),
          obstacleLayer: e.sourceLayer ?? 'Hit', isTrigger: !!e.sourceIsTrigger, gravityNative: c.gravity / .1,
        });
        this.ceiling = resolved.ceiling;
        let critical = false, movingHit = false;
        for (const action of resolved.actions) {
          if (action.type === 'disableForward') p.canAccelerateForward = false;
          if (action.type === 'setVerticalSpeed') {
            // Upper contacts retain the shoe curve record until its distance
            // endpoint. The distinct lower-obstacle hop interrupts it.
            if (action.value !== 0 || !this.ceiling.hit) p.sneakersJump = null;
            p.velocityY = action.value; if (action.value > 0) p.grounded = false;
          }
          if (action.type === 'rebound' && action.direction) {
            p.laneFrom = p.x; p.laneElapsed = 0; p.lane = clamp(p.lane + action.direction, 0, 2);
            p.laneDuration = Math.abs((p.lane - 1) - p.x / c.laneSpacing) * action.durationPerLane;
          }
          if (action.type === 'stumble') {
            const name = action.critical ? action.vertical === 'Upper' ? 'death_upper' : 'death_bounce'
              : action.horizontal === 'LeftCorner' ? 'stumble_corner_left'
              : action.horizontal.startsWith('Left') ? 'stumble_left'
              : action.horizontal.startsWith('Right') ? 'stumble_right'
              : action.vertical === 'Lower' ? 'stumble_low' : 'stumble_mix';
            this.stumble(name, name === 'stumble_left' ? .416667 : name === 'stumble_low' ? .625 : .833334,
              { collider: e, bush: action.stumbleType === 'Bush', safe: action.safe,
                horizontal: action.horizontal, vertical: action.vertical, animationCritical: action.critical });
          }
          if (action.type === 'hitByTrain') {
            movingHit = true;
            if (s.board.active) this.events.push({ type: 'train-jump', hoverboard: true });
          }
          if (action.type === 'criticalHit') {
            // Running.HandleCriticalHit shakes BEFORE Game.Die checks board
            // protection. A protected impact still has collision feedback.
            this.events.push({ type: 'critical-hit', obstacle: e.type });
            this.fatalHit(e, movingHit ? 'death_moving_train' : resolved.impact.y === 'upper' ? 'death_upper' : 'death_bounce');
            critical = true;
          }
        }
        if (critical || resolved.actions.some(action => action.type === 'rebound')) break;
      }
    }
    this.contacts = nextContacts;
    if (p.y < -6 && s.phase === 'running' && !s.flight) {
      this.fatalHit({ type: 'gap' }, 'caught_fall');
    }
    s.score = s.baseScore + s.coins * this.rawMultiplier * 2;
    this.entities = this.entities.filter(e => e.distance + (e.depth ?? 0) / 2 > s.distance - c.removeBehind);
    this.ensureCourse();
  }

  get rawMultiplier() { return clamp(Math.floor(this.config.playerLevel), 0, 30); }
  get scoreMultiplier() { return this.rawMultiplier * (this.state.powerups.doubleScore > 0 ? 2 : 1); }

  clearObstacles(start, end) {
    const hazards = this.entities.filter(e => !['coin', 'powerup', 'decoration'].includes(e.type)
      && e.distance + e.depth / 2 >= start && e.distance - e.depth / 2 <= end);
    const removed = new Set(hazards);
    // Source train groups have one collision proxy and several separate model
    // entities. Hide their matching instance descendants together, retaining
    // unrelated scenery, pickups and repeated instances of the same prefab.
    this.entities = this.entities.filter(e => {
      if (removed.has(e)) return false;
      if (e.type !== 'decoration' || !e.provenance?.graph) return true;
      return !hazards.some(h => h.provenance?.graph && h.provenance.chunkStart === e.provenance.chunkStart
        && (e.provenance.graph === h.provenance.graph || e.provenance.graph.startsWith(h.provenance.graph + '/')));
    });
  }

  protectWithBoard() {
    const active = this.hoverboard.state.active;
    const protectedHit = this.hoverboard.hit({ speedNormalized: this.state.speed / 11, flying: !!this.state.flight });
    if (protectedHit && active) this.events.push({ type: 'board-hit' });
    return protectedHit;
  }

  activatePowerup(type) {
    if (!(type in POWERUP_NAMES) || type === 'jetpack' && this.state.flight) return false;
    // Collection.Add resets an existing DoubleScore before TriggerPowerup's
    // +30*multiplier reward, then Begin enables the new double-score effect.
    if (type === 'doubleScore') delete this.state.powerups.doubleScore;
    this.state.baseScore += 30 * this.scoreMultiplier;
    this.state.powerups[type] = POWERUP_SECONDS[clamp(Math.floor(this.config.powerupTier), 0, POWERUP_SECONDS.length - 1)];
    if (type === 'jetpack') this.beginFlight(false);
    this.state.score = this.state.baseScore + this.state.coins * this.rawMultiplier * 2;
    this.events.push({ type: 'powerup', powerup: type, duration: this.state.powerups[type] });
    return true;
  }

  activateHeadstart() {
    if (this.state.phase !== 'running' || this.state.flight) return false;
    this.beginFlight(true);
    this.events.push({ type: 'headstart-start' }, { type: 'turbo-headstart', tier: 0 },
      { type: 'powerup', powerup: 'jetpack', headstart: true, duration: this.state.flight.timeLeft });
    return true;
  }

  beginFlight(headstart) {
    const s = this.state, p = s.player;
    let flight = this.jetpack.begin({ distance: s.distance, y: p.y, levelSpeed: s.levelSpeed, headstart });
    const landingSpeed = headstart ? this.config.maximumSpeed : s.levelSpeed;
    const target = this.routeGenerator?.scheduleJetpackLanding?.(flight.targetZ, this.nextSection,
      landingSpeed * Math.sqrt(2 * (headstart ? 12 : 9.5) / this.config.gravity) + this.config.playerRadius + landingSpeed * this.config.fixedStep * 2);
    if (target != null) flight = this.jetpack.extendTarget(target);
    s.flight = flight; s.speed = flight.speed; s.powerups.jetpack = flight.timeLeft;
    this.endRoll('jetpack');
    p.sneakersJump = null; p.grounded = false; p.velocityY = 0;
    this.hoverboard.state.flying = true;
    // Headstart bypasses the ordinary jetpack coin-line branch. Its separate
    // account-gated end rewards are outside this local demo.
    if (!headstart) for (const coin of makeFlightCoins({ start: flight.coinStartDistance,
      length: Math.max(0, flight.coinLength), height: 9.5, random: this.random }).coins) this.addEntity(coin);
  }

  attractCoin(coin) {
    const s = this.state, p = s.player;
    if ((!s.powerups.magnet && !s.powerups.sneakers) || coin.attraction) return;
    const x = coin.x ?? (coin.lane - 1) * this.config.laneSpacing, y = coin.y ?? 1.1;
    const distance = Math.hypot(x - p.x, y - p.y, coin.distance - s.distance);
    const magnet = s.powerups.magnet && (p.y < 7) === (y < 7)
      && Math.hypot(x - p.x, y - (p.y + 1.07), coin.distance - (s.distance - 1)) <= 8;
    // LongMagnet's Y capsule is rotated -30 degrees about X, so it reaches
    // below AND ahead of the airborne player. Preserve that source transform.
    const axisY = Math.sqrt(3) / 2, axisZ = -0.5;
    const dy = y - (p.y - 3.85 * axisY + 0.15);
    const dz = coin.distance - (s.distance + 1.925 + 0.3 * axisY);
    const along = clamp(dy * axisY + dz * axisZ, -4.55, 4.55);
    const sneakers = !s.flight && s.powerups.sneakers && Math.hypot(x - p.x, dy - along * axisY, dz - along * axisZ) <= 0.2;
    if (!magnet && !sneakers) return;
    coin.attraction = { x, y, distance: coin.distance, started: s.elapsed,
      duration: Math.max(this.config.fixedStep, distance / ((magnet ? 15 : 20) * s.speed / 11)) };
  }

  collectCoin(coin) {
    if (coin.collected) return;
    coin.collected = true; this.state.coins++;
    this.events.push({ type: 'coin', id: coin.id, x: coin.x, y: coin.y });
  }

  isCrossingRampSeam(train) {
    const { player, distance } = this.state, c = this.config;
    if (!player.grounded) return false;
    const front = train.distance - train.depth / 2;
    if (distance > front || distance < front - c.playerRadius - c.triggerForwardOffset) return false;
    return this.entities.some(ramp => {
      if (ramp.type !== 'ramp') return false;
      const end = ramp.distance + ramp.depth / 2;
      const x = ramp.x ?? (ramp.lane - 1) * c.laneSpacing;
      if (ramp.sourceShape) {
        const current = sourceVerticalBounds(ramp, player.x, distance);
        const atFront = sourceVerticalBounds(ramp, player.x, front + 1e-5);
        return current && atFront && Math.abs(player.y - current.top) < 0.04 && atFront.top >= train.height - 0.1;
      }
      if (Math.abs(ramp.height - train.height) > 0.08) return false;
      if (Math.abs(end - front) > 0.04 || Math.abs(player.x - x) > ramp.width / 2) return false;
      const relative = distance - (ramp.distance - ramp.depth / 2);
      if (relative < 0 || relative > ramp.depth) return false;
      const rampFloor = relative / ramp.depth * ramp.height;
      return Math.abs(player.y - rampFloor) < 0.04;
    });
  }

  surfaceHeight(distance, x, previousY) {
    const inside = entity => Math.abs((entity.x ?? (entity.lane - 1) * this.config.laneSpacing) - x) < entity.width / 2 && Math.abs(entity.distance - distance) < entity.depth / 2;
    let floor = this.entities.some(entity => (entity.type === 'gap' || entity.floor === false) && inside(entity)) ? -Infinity : 0;
    for (const e of this.entities) {
      if (e.collisionDisabled) continue;
      if (e.type !== 'train' && e.type !== 'ramp' && !e.walkable) continue;
      const entityX = e.x ?? (e.lane - 1) * this.config.laneSpacing;
      if (Math.abs(entityX - x) > e.width / 2) continue;
      const relative = distance - (e.distance - e.depth / 2);
      if (relative < 0 || relative > e.depth) continue;
      if (e.sourceShape) {
        const bounds = sourceVerticalBounds(e, x, distance);
        if (bounds && previousY >= bounds.top - (e.type === 'ramp' ? 0.35 : 0.12)) floor = Math.max(floor, bounds.top);
      } else if (e.type === 'ramp') {
        const height = e.surface ? this.sourceSurfaceHeight(e, x, distance) : (e.bottom ?? 0) + relative / e.depth * (e.height - (e.bottom ?? 0));
        if (height != null) floor = Math.max(floor, height);
      }
      else if (previousY >= e.height - 0.12) floor = Math.max(floor, e.height);
    }
    return floor;
  }

  sourceSurfaceHeight(entity, x, distance) {
    const surface = entity.surface, dx = x - entity.x, dz = distance - entity.distance;
    if (surface.polygon) {
      let sign = 0;
      for (let i = 0; i < surface.polygon.length; i++) {
        const a = surface.polygon[i], b = surface.polygon[(i + 1) % surface.polygon.length];
        const side = (b[0] - a[0]) * (dz - a[1]) - (b[1] - a[1]) * (dx - a[0]);
        if (Math.abs(side) < 1e-8) continue;
        if (sign && Math.sign(side) !== sign) return null;
        sign = Math.sign(side);
      }
    }
    return surface.a * dx + surface.b * dz + surface.c;
  }

  addEntity(entity) {
    const defaults = entity.type === 'train' ? { width: 1.8, height: 3, depth: 9 }
      : entity.type === 'overhead' ? { width: 1.9, bottom: 0.75, height: 2.8, depth: 0.65 }
      : entity.type === 'barrier' ? { width: 1.8, height: 0.95, depth: 0.6 }
      : { width: 1.8, height: 0, depth: 0 };
    const e = { ...defaults, ...entity, id: this.nextId++, collected: false };
    this.entities.push(e);
    return e;
  }

  ensureCourse() {
    while (this.nextSection < this.state.distance + this.config.lookAhead) {
      if (this.routeGenerator) this.addSourceSection();
      else if (this.routeLibrary.length) this.addRecoveredSection();
      else this.addProvisionalSection();
      this.sectionCount++;
    }
  }

  addSourceSection() {
    const chunk = this.routeGenerator.nextChunk({ startDistance: this.nextSection, speed: this.state.speed, elapsed: this.state.elapsed, playerDistance: this.state.distance, sectionIndex: this.sectionCount });
    if (!Number.isFinite(chunk.length) || chunk.length <= 0) throw new Error('Recovered route chunk has no positive verified length');
    for (const entity of chunk.entities) this.addEntity(entity);
    this.routeTrace.push({ startDistance: this.nextSection, length: chunk.length, ...chunk.provenance, decisions: chunk.decisions });
    this.nextSection += chunk.length;
  }

  addRecoveredSection() {
    const chunk = this.routeLibrary[Math.floor(this.random() * this.routeLibrary.length)];
    for (const e of chunk.entities) this.addEntity({ ...e, distance: this.nextSection + e.distance, source: chunk.source });
    this.nextSection += Math.max(24, chunk.length);
  }

  addProvisionalSection() {
    // Provisional course composition, replaced when source route transforms have
    // been resolved. There is always at least one unblocked lane per row.
    const base = this.nextSection;
    for (let row = 0; row < 3; row++) {
      const at = base + row * 19;
      const blocked = Math.floor(this.random() * 3);
      const choice = this.sectionCount === 0 ? row % 3 : Math.floor(this.random() * 3);
      const type = ['barrier', 'overhead', 'train'][choice];
      this.addEntity({ type, lane: blocked, distance: at });
      if (type === 'train' && (this.sectionCount === 0 || this.sectionCount % 3 === 0)) {
        const rampDistance = at - 7.5;
        this.addEntity({ type: 'ramp', lane: blocked, distance: rampDistance, width: 1.8, height: 3, depth: 6 });
        for (let i = 1; i < 10; i++) {
          const distance = at - 10.5 + i * 1.2;
          const floor = Math.min(3, i * 1.2 / 6 * 3);
          this.addEntity({ type: 'coin', lane: blocked, distance, y: floor + 1.1 });
        }
      }
      let safe = (blocked + 1 + Math.floor(this.random() * 2)) % 3;
      for (let i = 0; i < 6; i++) this.addEntity({ type: 'coin', lane: safe, distance: at - 5 + i * 1.6, y: 1.1 });
      if (this.sectionCount > 1 && this.random() > 0.65) {
        const other = [0, 1, 2].find(l => l !== safe && l !== blocked);
        this.addEntity({ type: 'barrier', lane: other, distance: at });
      }
    }
    this.nextSection += 60;
  }

  drainEvents() { const events = this.events; this.events = []; return events; }
}
