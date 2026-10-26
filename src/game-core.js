import { DEFAULT_CONFIG } from './config.js';

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
    this.nextId = 0;
    this.events = [];
    this.entities = [];
    this.nextSection = this.routeGenerator?.initialDistance ?? 28;
    this.sectionCount = 0;
    this.state = {
      phase: 'ready', distance: 0, coins: 0, score: 0,
      speed: this.config.initialSpeed, elapsed: 0,
      player: { lane: 1, x: 0, y: 0, velocityY: 0, rollRemaining: 0,
        grounded: true, floor: 0, laneFrom: 0, laneElapsed: 0, laneDuration: this.config.laneChangeSeconds },
      collision: null,
    };
    this.ensureCourse();
  }

  start() {
    if (this.state.phase === 'gameover') this.reset();
    this.state.phase = 'running';
    this.events.push({ type: 'start' });
  }

  pause() {
    if (this.state.phase === 'running') this.state.phase = 'paused';
    else if (this.state.phase === 'paused') this.state.phase = 'running';
    this.accumulator = 0;
  }

  action(action) {
    if (this.state.phase !== 'running') return false;
    const p = this.state.player;
    if (action === 'left' || action === 'right') {
      const next = clamp(p.lane + (action === 'left' ? -1 : 1), 0, 2);
      if (next === p.lane) return false;
      p.laneFrom = p.x;
      p.laneElapsed = 0;
      p.laneDuration = Math.abs((next - 1) - p.x / this.config.laneSpacing) * this.config.laneChangeSeconds;
      p.lane = next;
      this.events.push({ type: 'lane', lane: next });
      return true;
    }
    if (action === 'jump' && p.grounded) {
      p.rollRemaining = 0;
      p.velocityY = Math.sqrt(2 * this.config.gravity * this.config.jumpHeight);
      p.grounded = false;
      this.events.push({ type: 'jump' });
      return true;
    }
    if (action === 'roll') {
      if (!p.grounded) p.velocityY = Math.min(p.velocityY, -12);
      p.rollRemaining = this.config.rollSeconds;
      this.events.push({ type: 'roll' });
      return true;
    }
    return false;
  }

  advance(seconds) {
    if (this.state.phase !== 'running') return;
    // Ignore tab suspension gaps without making the player teleport into hazards.
    this.accumulator += clamp(seconds, 0, 0.1);
    const dt = this.config.fixedStep;
    while (this.accumulator + 1e-10 >= dt && this.state.phase === 'running') {
      this.step(dt);
      this.accumulator -= dt;
    }
  }

  step(dt) {
    const s = this.state, p = s.player, c = this.config;
    const previousDistance = s.distance;
    s.elapsed += dt;
    s.speed = Math.min(c.maximumSpeed, s.speed + c.acceleration * dt);
    s.distance += s.speed * dt;
    for (const entity of this.entities) {
      entity.previousDistance = entity.distance;
      if (entity.movingTrain) entity.distance = entity.movingTrain.initialDistance - (s.distance - entity.movingTrain.referencePlayerDistance) * entity.movingTrain.ratio;
      else if (entity.velocityZ) entity.distance -= entity.velocityZ * dt;
    }
    p.laneElapsed += dt;
    const blend = clamp(p.laneElapsed / Math.max(dt, p.laneDuration), 0, 1);
    p.x = p.laneFrom + ((p.lane - 1) * c.laneSpacing - p.laneFrom) * blend;
    p.rollRemaining = Math.max(0, p.rollRemaining - dt);
    const previousY = p.y;
    p.velocityY -= c.gravity * dt;
    p.y += p.velocityY * dt;
    const floor = this.surfaceHeight(s.distance, p.x, previousY);
    if (p.y <= floor && p.velocityY <= 0) {
      if (!p.grounded) this.events.push({ type: 'land' });
      p.y = floor;
      p.velocityY = 0;
      p.grounded = true;
    } else p.grounded = false;
    p.floor = floor;

    for (const e of this.entities) {
      if (e.collected) continue;
      const x = e.x ?? (e.lane - 1) * c.laneSpacing;
      const longitudinal = e.distance - s.distance;
      if (e.type === 'coin') {
        const center = p.y + (p.rollRemaining > 0 ? 0.4 : 1);
        if (Math.abs(longitudinal) < 0.72 && Math.abs(x - p.x) < 0.7 && Math.abs((e.y ?? 1.1) - center) < 1) {
          e.collected = true;
          s.coins++;
          this.events.push({ type: 'coin', id: e.id, x, y: e.y ?? 1.1 });
        }
        continue;
      }
      if (e.type === 'ramp' || e.type === 'decoration' || e.type === 'gap') continue;
      const halfDepth = e.depth / 2 + c.playerRadius;
      const oldRelative = (e.previousDistance ?? e.distance) - previousDistance;
      const newRelative = e.distance - s.distance;
      const sweptZ = Math.max(oldRelative, newRelative) >= -halfDepth && Math.min(oldRelative, newRelative) <= halfDepth;
      if (!sweptZ || Math.abs(x - p.x) >= e.width / 2 + c.playerRadius) continue;
      const contactX = clamp(p.x, x - e.width / 2 + 1e-6, x + e.width / 2 - 1e-6);
      const contactZ = clamp(s.distance, e.distance - e.depth / 2 + 1e-6, e.distance + e.depth / 2 - 1e-6);
      const sourceBounds = sourceVerticalBounds(e, contactX, contactZ);
      if (!sourceBounds) continue;
      const bottom = sourceBounds.bottom;
      const top = sourceBounds.top;
      const playerTop = p.y + (p.rollRemaining > 0 ? c.rollingHeight : c.standingHeight);
      if (playerTop > bottom + 0.04 && p.y < top - 0.08) {
        // A radius-expanded train front overlaps the last part of an adjoining
        // ramp. That shared walkable seam is not a vertical wall. Only waive
        // the front contact while grounded on the matching supporting ramp;
        // the same train remains solid for a runner approaching from the ground.
        if (e.type === 'train' && this.isCrossingRampSeam(e)) continue;
        s.phase = 'gameover';
        s.collision = { id: e.id, type: e.type, distance: s.distance };
        this.events.push({ type: 'crash', obstacle: e.type });
        break;
      }
    }
    if (p.y < -6 && s.phase === 'running') {
      s.phase = 'gameover'; s.collision = { type: 'gap', distance: s.distance };
      this.events.push({ type: 'crash', obstacle: 'gap' });
    }
    s.score = Math.floor(s.distance * c.distanceScore) + s.coins * c.coinScore;
    this.entities = this.entities.filter(e => e.distance + (e.depth ?? 0) / 2 > s.distance - c.removeBehind);
    this.ensureCourse();
  }

  isCrossingRampSeam(train) {
    const { player, distance } = this.state, c = this.config;
    if (!player.grounded) return false;
    const front = train.distance - train.depth / 2;
    if (distance > front || distance < front - c.playerRadius) return false;
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
      : entity.type === 'overhead' ? { width: 1.9, bottom: 1.15, height: 2.8, depth: 0.65 }
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
