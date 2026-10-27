/** Source CapsuleTrigger dimensions; contact detection is a browser physics
 * adapter, independent of the native AABB impact classification. */
import { DEFAULT_CONFIG } from './config.js';

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const sub = (a, b) => a.map((x, i) => x - b[i]);
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

export function segmentBoxDistanceSquared(a, b, half) {
  const d = sub(b, a), breaks = [0, 1];
  for (let i = 0; i < 3; i++) if (Math.abs(d[i]) > 1e-12) {
    for (const sign of [-1, 1]) {
      const t = (sign * half[i] - a[i]) / d[i];
      if (t > 0 && t < 1) breaks.push(t);
    }
  }
  breaks.sort((x, y) => x - y);
  const at = t => a.reduce((sum, v, i) => sum + Math.max(0, Math.abs(v + d[i] * t) - half[i]) ** 2, 0);
  let best = Infinity;
  for (let j = 0; j < breaks.length - 1; j++) {
    const lo = breaks[j], hi = breaks[j + 1], mid = (lo + hi) / 2;
    best = Math.min(best, at(lo), at(hi));
    let numerator = 0, denominator = 0;
    for (let i = 0; i < 3; i++) {
      const value = a[i] + d[i] * mid;
      if (Math.abs(value) <= half[i]) continue;
      numerator += d[i] * (a[i] - Math.sign(value) * half[i]); denominator += d[i] ** 2;
    }
    if (denominator > 0) best = Math.min(best, at(clamp(-numerator / denominator, lo, hi)));
  }
  return best;
}

export function segmentSegmentDistanceSquared(p, q, a, b) {
  const d = sub(q, p), e = sub(b, a), r = sub(p, a);
  const dd = dot(d, d), ee = dot(e, e), de = dot(d, e), dr = dot(d, r), er = dot(e, r);
  let s = 0, t = 0;
  if (dd < 1e-16 && ee < 1e-16) return dot(r, r);
  if (dd < 1e-16) t = clamp(er / ee, 0, 1);
  else if (ee < 1e-16) s = clamp(-dr / dd, 0, 1);
  else {
    const denom = dd * ee - de * de;
    s = denom > 1e-16 ? clamp((de * er - dr * ee) / denom, 0, 1) : 0;
    t = (de * s + er) / ee;
    if (t < 0) { t = 0; s = clamp(-dr / dd, 0, 1); }
    else if (t > 1) { t = 1; s = clamp((de - dr) / dd, 0, 1); }
  }
  const v = r.map((x, i) => x + s * d[i] - t * e[i]);
  return dot(v, v);
}

export function runnerCapsule(position, rolling, config = DEFAULT_CONFIG) {
  const radius = config.playerRadius, bottom = rolling ? config.rollingBottom : config.standingBottom;
  const height = Math.max(radius * 2, rolling ? config.rollingHeight : config.standingHeight);
  const center = [position[0], position[1] + bottom + height / 2, position[2] + config.triggerForwardOffset];
  const segment = height / 2 - radius;
  return { a: [center[0], center[1] - segment, center[2]], b: [center[0], center[1] + segment, center[2]], radius };
}

/** Signed separation: <=0 is contact. Rotated boxes use orthogonal world axes.
 * Capsule scaling follows the supplied uniform source transforms. Unsupported
 * shear/nonuniform capsules use a conservative AABB and remain an explicit
 * adapter; audited default route instances do not require that fallback. */
export function capsuleEntitySeparation(capsule, entity) {
  const { a, b, radius } = capsule, shape = entity.sourceShape;
  if (shape) {
    const norms = shape.rows.map(row => Math.hypot(...row.slice(0, 3)));
    const orthogonal = norms.every(x => x > 0) && [0, 1, 2].every(i =>
      [0, 1, 2].every(j => i === j || Math.abs(dot(shape.rows[i].slice(0, 3), shape.rows[j].slice(0, 3)) / norms[i] / norms[j]) < 1e-6));
    const local = point => shape.rows.map((row, i) =>
      (row[0] * (point[0] - entity.x) + row[1] * point[1] + row[2] * (point[2] - entity.distance) + row[3]) / norms[i]);
    if (orthogonal && shape.type === 'box')
      return Math.sqrt(segmentBoxDistanceSquared(local(a), local(b), shape.halfSize.map((v, i) => v / norms[i]))) - radius;
    if (orthogonal && shape.type === 'capsule' && Math.max(...norms) / Math.min(...norms) < 1 + 1e-6) {
      const ca = [0, 0, 0], cb = [0, 0, 0], scale = norms[shape.axis];
      ca[shape.axis] = -shape.halfSegment / scale; cb[shape.axis] = -ca[shape.axis];
      return Math.sqrt(segmentSegmentDistanceSquared(local(a), local(b), ca, cb)) - radius - shape.radius / scale;
    }
  }
  const center = [entity.x, ((entity.bottom ?? 0) + entity.height) / 2, entity.distance];
  return Math.sqrt(segmentBoxDistanceSquared(sub(a, center), sub(b, center),
    [entity.width / 2, (entity.height - (entity.bottom ?? 0)) / 2, entity.depth / 2])) - radius;
}

export function overlapsRunnerEntity(state, entity, config = DEFAULT_CONFIG) {
  return capsuleEntitySeparation(runnerCapsule([state.player.x, state.player.y, state.distance],
    state.player.rollRemaining > 0, config), entity) <= 1e-9;
}

/** Relative swept capsule test. Linear motion within a fixed tick is an
 * adapter, not a claim of reproducing PhysX callback timing. Convex distance
 * minimization catches thin obstacles crossed between two separated poses. */
export function runnerEntityContact(previous, current, entity, rolling, config = DEFAULT_CONFIG) {
  const beforeZ = entity.previousDistance ?? entity.distance;
  const at = t => previous.map((v, i) => v + (current[i] - v) * t);
  const obstacleAt = t => ({ ...entity, distance: beforeZ + (entity.distance - beforeZ) * t });
  const distance = t => capsuleEntitySeparation(runnerCapsule(at(t), rolling, config), obstacleAt(t));
  if (distance(1) <= 1e-9) return { time: 1, position: current, entity, overlapping: true };
  if (distance(0) <= 1e-9) return null; // Already leaving; do not create a new Enter.
  let lo = 0, hi = 1;
  for (let i = 0; i < 36; i++) {
    const a = (2 * lo + hi) / 3, b = (lo + 2 * hi) / 3;
    if (distance(a) < distance(b)) hi = b; else lo = a;
  }
  const middle = (lo + hi) / 2;
  if (distance(middle) > 1e-9) return null;
  lo = 0; hi = middle;
  for (let i = 0; i < 32; i++) { const t = (lo + hi) / 2; if (distance(t) <= 1e-9) hi = t; else lo = t; }
  return { time: hi, position: at(hi), entity: obstacleAt(hi), overlapping: false };
}
