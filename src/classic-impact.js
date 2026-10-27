/**
 * Classic native fallback, statically recovered from APK 7.07.0.
 * Evidence: analysis/classic/collision-v2/impact-findings.json.
 * Call after contact-enter detection and the existing one-second collider
 * memory check. This module does not perform physics broadphase, change lane
 * state, advance timers, invoke Game.Die, or decide hoverboard protection.
 */
export const CLASSIC_IMPACT_SOURCE = Object.freeze({
  xTrackWidthCoefficient: 0.33, // native float64 at 0x4026858
  yLowerThreshold: 0.33000001311302185, // native float32 at 0x4026848
  yUpperThreshold: 0.6600000262260437, // native float32 at 0x4025edc
  trackWidthNative: 20,
  cornerToleranceNative: 15,
  shortObstacleLengthNative: 30,
  lowImpactHopHeightNative: 8,
  gliderLowImpactHopHeightNative: 1.5,
  normalizationEpsilon: 9.999999747378752e-6,
  reboundDurationPerLane: 0.5,
  tutorialReboundDurationPerLane: 0.20000000298023224,
});

const f = Math.fround;
const xyz = v => Array.isArray(v) ? v : [v.x, v.y, v.z];
const midpoint = (a, b) => f(f(a + b) * 0.5);
const nativeVector = (v, scale) => xyz(v).map(x => f(x / scale));
function geometry({ obstacleBounds, characterBounds, position, unitScale = 1 }) {
  if (!(unitScale > 0) || !Number.isFinite(unitScale)) throw new Error('Invalid impact unitScale');
  const convert = b => ({ min: nativeVector(b.min, unitScale), max: nativeVector(b.max, unitScale) });
  return { obstacle: convert(obstacleBounds), character: convert(characterBounds),
    position: nativeVector(position, unitScale), unitScale };
}

/**
 * Inputs are world AABBs and character transform position in caller units;
 * unitScale is caller units per native unit (browser: 0.1). X uses the source
 * ColliderTrackWidth, not the capsule diameter. Helpers do not test overlap.
 * Float32 operations precede X's float64 threshold, matching native order.
 */
export function classifyImpact(input) {
  const { obstacle: o, character: c, position: p } = geometry(input);
  const trackWidth = f(input.trackWidthNative ?? CLASSIC_IMPACT_SOURCE.trackWidthNative);
  const tolerance = f(input.cornerToleranceNative ?? CLASSIC_IMPACT_SOURCE.cornerToleranceNative);
  const overlapX = [Math.max(c.min[0], o.min[0]), Math.min(c.max[0], o.max[0])];
  const offsetXNative = f(midpoint(...overlapX) - o.min[0]);
  const obstacleWidthNative = f(o.max[0] - o.min[0]);
  const thresholdXNative = trackWidth * CLASSIC_IMPACT_SOURCE.xTrackWidthCoefficient;
  // Right is checked first even for an obstacle narrower than two thresholds.
  const x = offsetXNative > obstacleWidthNative - thresholdXNative ? 'right'
    : offsetXNative >= thresholdXNative ? 'middle' : 'left';
  const overlapY = [Math.max(c.min[1], o.min[1]), Math.min(c.max[1], o.max[1])];
  const overlapRatioY = f(f(midpoint(...overlapY) - c.min[1]) / f(c.max[1] - c.min[1]));
  const y = overlapRatioY < CLASSIC_IMPACT_SOURCE.yLowerThreshold ? 'lower'
    : overlapRatioY < CLASSIC_IMPACT_SOURCE.yUpperThreshold ? 'middle' : 'upper';
  const obstacleLengthNative = f(o.max[2] - o.min[2]);
  const endToleranceNative = obstacleLengthNative > CLASSIC_IMPACT_SOURCE.shortObstacleLengthNative
    ? tolerance : f(obstacleLengthNative * 0.5);
  // The front threshold always uses tolerance, including short obstacles.
  const frontBoundaryNative = f(o.min[2] + tolerance);
  const backBoundaryNative = f(o.max[2] - endToleranceNative);
  const z = p[2] > backBoundaryNative ? 'after' : p[2] >= frontBoundaryNative ? 'middle' : 'before';
  return { x, y, z, offsetXNative, obstacleWidthNative, thresholdXNative, overlapRatioY,
    obstacleLengthNative, endToleranceNative, frontBoundaryNative, backBoundaryNative };
}

/** Native 36294: motion against the collider-min/top-center plane. */
export function enteredColliderFromBelow(input) {
  const { obstacle: o, character: c, position: p, unitScale } = geometry(input);
  const last = input.lastFixedPosition ? nativeVector(input.lastFixedPosition, unitScale) : p;
  const previous = input.previousFixedPosition ? nativeVector(input.previousFixedPosition, unitScale) : last;
  const topCenter = [f(c.max[0] - f(f(c.max[0] - c.min[0]) * 0.5)), c.max[1],
    f(c.max[2] - f(f(c.max[2] - c.min[2]) * 0.5))];
  const towardMin = o.min.map((value, axis) => f(value - topCenter[axis]));
  const [vx, vy, vz] = towardMin;
  const length = f(Math.sqrt(f(f(vz * vz) + f(f(vx * vx) + f(vy * vy)))));
  const n = length > CLASSIC_IMPACT_SOURCE.normalizationEpsilon
    ? towardMin.map(value => f(value / length)) : [0, 0, 0];
  const delta = last.map((value, axis) => f(value - previous[axis]));
  // The native cross product uses Vector3.left; retain its operation order.
  const crossX = f(f(n[1] * 0) - f(n[2] * 0));
  const crossY = f(f(n[2] * -1) - f(n[0] * 0));
  const crossZ = f(f(n[0] * 0) - f(n[1] * -1));
  const signedValue = f(f(f(-f(delta[1] * crossY)) - f(delta[0] * crossX)) - f(delta[2] * crossZ));
  return { entered: signedValue < 0, signedValue, topCenterNative: topCenter,
    normalizedTowardMin: n, deltaNative: delta,
    snapshotsProvided: !!(input.lastFixedPosition && input.previousFixedPosition) };
}

/**
 * Ordered Character.OnCharacterTriggerEnter solid/Hit-trigger actions.
 * trackMovement: +1 toward increasing lane X, -1 toward decreasing X, 0 idle.
 * `ceiling.minY`, action `value` and all geometry use caller units. Native
 * distances/velocities are separately named. Keep action order: a front
 * HitBounceOnly corner can notify TWO stumbles in one invocation.
 *
 * Caller supplies actual obstacle layer/tag/isTrigger, not visual heuristics.
 * Defaults model ordinary classic play; special-mode exemptions/hotfixes are
 * not inferred. `teleboard`/`gliderboard` expose the observed local branches.
 */
export function resolveClassicImpact(input) {
  const { obstacle: o, character: c, position: p, unitScale } = geometry(input);
  const impact = classifyImpact(input);
  const actions = [];
  const ceiling = { hit: false, minY: 0, evaded: false, ...input.ceiling };
  const result = { impact, ceiling, actions, branch: 'none' };
  const { obstacleTag = '', obstacleLayer = 'Hit', isTrigger = false,
    trackMovement = 0, jumping = false, grounded = false, tutorial = false,
    teleboard = false, gliderboard = false, gravityNative = 200 } = input;
  if (![-1, 0, 1].includes(trackMovement)) throw new Error('Invalid trackMovement');
  const stumble = (horizontal, vertical, critical = false, stumbleType = 'Normal') => actions.push({
    type: 'stumble', stumbleType, horizontal, vertical, safe: false, critical,
  });
  const rebound = force => actions.push({ type: 'rebound', direction: -trackMovement, force,
    durationPerLane: !force && tutorial ? CLASSIC_IMPACT_SOURCE.tutorialReboundDurationPerLane
      : CLASSIC_IMPACT_SOURCE.reboundDurationPerLane });
  const verticalSpeed = valueNative => actions.push({ type: 'setVerticalSpeed', valueNative,
    value: valueNative * unitScale });
  const trainHit = () => actions.push({ type: 'disableForward' }, { type: 'hitByTrain' }, { type: 'criticalHit' });

  if (obstacleLayer === 'Default' || obstacleLayer === 'Unremovable') {
    result.branch = 'non-impact-layer'; return result;
  }
  if (isTrigger) {
    result.branch = obstacleLayer === 'Hit' ? 'hit-trigger' : 'ignored-trigger';
    if (obstacleLayer === 'Hit') {
      if (obstacleTag === 'Stumble') stumble('Center', 'Lower', false, 'Bush');
      else stumble('Center', 'Middle');
    }
    return result;
  }

  const obstacleCenterX = midpoint(o.min[0], o.max[0]);
  const towardCenter = p[0] < obstacleCenterX ? trackMovement === 1
    : p[0] > obstacleCenterX ? trackMovement === -1 : true;
  const centerPastFront = midpoint(c.min[2], c.max[2]) >= o.min[2];
  const oldCeilingHit = ceiling.hit;
  const oldCeilingMinYNative = f(ceiling.minY / unitScale);
  result.towardCenter = towardCenter;
  result.centerPastFront = centerPastFront;
  if (impact.y === 'upper' && jumping && !grounded) {
    ceiling.hit = true;
    ceiling.evaded = false;
    if (!oldCeilingHit) ceiling.minY = o.min[1] * unitScale;
    verticalSpeed(0);
  }
  if ((centerPastFront && impact.z === 'before' && towardCenter) || impact.z === 'middle') {
    result.branch = 'side';
    if (trackMovement !== 0) rebound(false);
    if (impact.x === 'right') stumble('Right', 'Middle');
    else if (impact.x === 'left') stumble('Left', 'Middle');
    return result;
  }

  if (impact.x !== 'middle' && trackMovement !== 0) {
    result.branch = 'corner';
    if (impact.z === 'before' && towardCenter) {
      if (obstacleTag === 'HitMovingTrain') trainHit();
      else if (obstacleLayer === 'HitBounceOnly') {
        if (!teleboard) stumble('Center', 'Lower');
      } else rebound(true);
    } else if (obstacleLayer === 'HitBounceOnly') rebound(true);
    if (!teleboard) stumble(impact.x === 'left' ? 'LeftCorner' : 'RightCorner', 'Middle');
    return result;
  }
  if (impact.z !== 'before') { result.branch = 'behind'; return result; }
  if (impact.y === 'lower') {
    result.branch = 'front-lower';
    const height = gliderboard ? CLASSIC_IMPACT_SOURCE.gliderLowImpactHopHeightNative
      : CLASSIC_IMPACT_SOURCE.lowImpactHopHeightNative;
    verticalSpeed(f(Math.sqrt(f(f(height + height) * f(gravityNative)))));
    if (teleboard) actions.push({ type: 'resetTeleportFX' });
    else stumble('Center', 'Lower');
    return result;
  }
  if (obstacleTag === 'HitMovingTrain') {
    result.branch = 'front-moving-train'; trainHit(); return result;
  }
  if (impact.y === 'middle') {
    result.branch = 'front-middle';
    actions.push({ type: 'disableForward' });
  } else {
    const fromBelow = enteredColliderFromBelow(input);
    result.fromBelow = fromBelow;
    result.priorLowEnough = oldCeilingHit && oldCeilingMinYNative <= o.min[1];
    if (jumping && ((ceiling.hit && fromBelow.entered) || result.priorLowEnough)) {
      result.branch = 'ceiling-evasion'; return result;
    }
    result.branch = 'front-upper';
  }
  if (teleboard) actions.push({ type: 'resetTeleportFX' });
  else stumble('Center', impact.y === 'middle' ? 'Middle' : 'Upper', true);
  actions.push({ type: 'criticalHit' });
  return result;
}
