/**
 * Browser contact-normal adapter. This sweeps the replacement runner against
 * the recovered world AABB; it does not invent the two still-protected native
 * ObstacleImpactUtil X/Y classification thresholds.
 */
export function horizontalContact({ previousX, x, previousDistance, distance, radius }, entity) {
  const halfX = entity.width / 2 + radius, halfZ = entity.depth / 2 + radius;
  const start = [previousX - entity.x, previousDistance - (entity.previousDistance ?? entity.distance)];
  const end = [x - entity.x, distance - entity.distance], half = [halfX, halfZ];
  const entry = [-Infinity, -Infinity]; let enter = 0, leave = 1;
  for (let axis = 0; axis < 2; axis++) {
    const delta = end[axis] - start[axis];
    if (Math.abs(delta) < 1e-12) { if (Math.abs(start[axis]) >= half[axis]) return null; continue; }
    const a = (-half[axis] - start[axis]) / delta, b = (half[axis] - start[axis]) / delta;
    entry[axis] = Math.min(a, b); enter = Math.max(enter, entry[axis]); leave = Math.min(leave, Math.max(a, b));
  }
  if (enter > leave || leave < 0 || enter > 1) return null;
  return { side: entry[0] > entry[1] && entry[0] >= 0, t: enter,
    direction: Math.sign(x - previousX), source: 'browser-swept-contact-normal' };
}
