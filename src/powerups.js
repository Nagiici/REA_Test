import { SNEAKERS } from './sneakers-curve.js';

// APK 7.07.0 native fallback. Account upgrades/XLua overrides are not applied.
// Upgrades.cctor field134086; PlayerInfo.GetPowerupDuration indexes by tier.
export const POWERUP_SECONDS = Object.freeze([10, 11.5, 13.4, 15.8, 19, 24, 30]);
export const POWERUP_NAMES = Object.freeze({ magnet: '金币磁铁', sneakers: '超级跑鞋', doubleScore: '双倍积分' });
export { SNEAKERS };

export function curveValue(keys, time) {
  const t = Math.max(keys[0].time, Math.min(keys.at(-1).time, time));
  const end = keys.findIndex((key, i) => i > 0 && key.time >= t);
  const a = keys[end - 1], b = keys[end], span = b.time - a.time, u = (t - a.time) / span;
  return (2*u**3-3*u*u+1)*a.value + (u**3-2*u*u+u)*span*a.outSlope
    + (-2*u**3+3*u*u)*b.value + (u**3-u*u)*span*b.inSlope;
}

// Source SpawnPoint SphereCollider against the source CharacterTrigger capsule.
// Rendering height is independent from the recovered pickup capsule (r3,h10).
export function touchesPowerup(entity, player, distance, previousDistance) {
  const trigger = entity.sourcePickupTrigger;
  const center = trigger?.center ?? [entity.x ?? 0, entity.y ?? 0.85, entity.distance];
  const radius = (trigger?.radius ?? 0.7) + 0.3;
  const capsuleZ = Math.max(previousDistance + 0.1, Math.min(distance + 0.1, center[2]));
  const capsuleY = Math.max(player.y + 0.35, Math.min(player.y + 0.75, center[1]));
  return (center[0]-player.x)**2 + (center[1]-capsuleY)**2 + (center[2]-capsuleZ)**2 <= radius**2;
}
