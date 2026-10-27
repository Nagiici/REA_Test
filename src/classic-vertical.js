import { SNEAKERS, curveValue } from './powerups.js';

/** CharacterBase.MoveForward81723, after ApplyGravity. Browser units; no
 * physical depenetration here. Evidence: collision-v6/findings.json. */
export function classicVerticalMotion({ y, velocityY, dt, gravity, jumping,
  ceiling, triggerMaxY, sneakersJump, oldDistance, nextDistance }) {
  const upper = { ...ceiling };
  let dy = velocityY * dt, allowCurve = true, jump = sneakersJump;
  if (jumping && upper.hit) {
    allowCurve = false;
    if (upper.evaded || upper.minY >= triggerMaxY) { upper.evaded = true; dy = 0; }
    else dy = velocityY >= 0 ? -gravity * dt * dt : 0;
    if (velocityY < 0) dy = velocityY * dt;
  }
  if (jumping && jump) {
    if (oldDistance >= jump.startDistance + jump.length) {
      jump = null; velocityY = 0; dy = 0;
    } else if (!allowCurve) dy = 0;
    else dy = jump.startY + SNEAKERS.height * curveValue(SNEAKERS.curve,
      (nextDistance - jump.startDistance) / jump.length) - y;
  }
  return { dy, velocityY, ceiling: upper, sneakersJump: jump };
}
