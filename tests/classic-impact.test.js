import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyImpact, resolveClassicImpact, enteredColliderFromBelow,
  CLASSIC_IMPACT_SOURCE as SOURCE } from '../src/classic-impact.js';
import { ClassicCollisionState } from '../src/classic-collision.js';

const base = ({ x = 0, z = 0, low = 0, high = 20, ...other } = {}) => ({
  obstacleBounds: { min: [-10, low, 3], max: [10, high, 63] },
  characterBounds: { min: [x - 3, 0.5, z - 2], max: [x + 3, 10.5, z + 4] },
  position: [x, 0, z], ...other,
});
const types = result => result.actions.map(action => action.type);

test('X preserves float64 .33 threshold, float32 overlap and right-first narrow cases', () => {
  const classifyX = offset => classifyImpact({ ...base(),
    obstacleBounds: { min: [0, 0, 3], max: [20, 20, 63] },
    characterBounds: { min: [offset, .5, -2], max: [offset, 10.5, 4] },
  }).x;
  assert.equal(classifyX(6.599999904632568), 'left');
  assert.equal(classifyX(6.600000381469727), 'middle');
  assert.equal(classifyX(13.399999618530273), 'middle');
  assert.equal(classifyX(13.40000057220459), 'right');
  const narrow = classifyImpact({ ...base(), obstacleBounds: { min: [-3, 0, 3], max: [3, 20, 63] } });
  assert.equal(narrow.x, 'right');
  assert.equal(narrow.thresholdXNative, 6.6000000000000005);
});

test('Y equal thresholds select middle and upper; lower/middle use overlap midpoint', () => {
  const sample = (lo, hi) => classifyImpact({ ...base(),
    obstacleBounds: { min: [-10, lo, 3], max: [10, hi, 63] },
    characterBounds: { min: [-3, 0, -2], max: [3, 1, 4] },
  });
  assert.equal(sample(0, .6599).y, 'lower');
  assert.equal(sample(0, .66).overlapRatioY, SOURCE.yLowerThreshold);
  assert.equal(sample(0, .66).y, 'middle');
  assert.equal(sample(.3199, 1).y, 'middle');
  assert.equal(sample(.32, 1).y, 'middle'); // float32 midpoint rounds just below .66
  assert.equal(sample(.32000005, 1).overlapRatioY, SOURCE.yUpperThreshold);
  assert.equal(sample(.32000005, 1).y, 'upper');
});

test('Z preserves strict far threshold and asymmetric short-object front threshold', () => {
  const longAt = z => classifyImpact(base({ z })).z;
  assert.equal(longAt(17.999), 'before');
  assert.equal(longAt(18), 'middle');
  assert.equal(longAt(48), 'middle');
  assert.equal(longAt(48.001), 'after');
  const shortAt = z => classifyImpact({ ...base({ z }),
    obstacleBounds: { min: [-10, 0, 3], max: [10, 20, 13] },
  }).z;
  assert.equal(shortAt(8), 'before');
  assert.equal(shortAt(8.001), 'after');
  assert.equal(shortAt(18), 'after');
});

test('front lower contact hops eight native units and emits a noncritical stumble', () => {
  const hit = resolveClassicImpact(base({ high: 4, obstacleTag: 'HitBarrierJump' }));
  assert.equal(hit.branch, 'front-lower');
  assert.deepEqual(types(hit), ['setVerticalSpeed', 'stumble']);
  assert.equal(hit.actions[0].valueNative, Math.fround(Math.sqrt(3200)));
  assert.equal(hit.actions[1].vertical, 'Lower');
  assert.equal(hit.actions[1].safe, false);
  assert.equal(hit.actions[1].critical, false);
  const original = base({ high: 4 });
  const scale = v => v.map(x => x * .1);
  const browser = resolveClassicImpact({ ...original, unitScale: .1,
    position: scale(original.position),
    obstacleBounds: { min: scale(original.obstacleBounds.min), max: scale(original.obstacleBounds.max) },
    characterBounds: { min: scale(original.characterBounds.min), max: scale(original.characterBounds.max) },
  });
  assert.deepEqual(browser.impact, hit.impact);
  assert.equal(browser.actions[0].value, hit.actions[0].valueNative * .1);
});

test('side contact reverses lane movement with source duration and side enum', () => {
  const side = resolveClassicImpact(base({ x: -8, z: 20, trackMovement: 1 }));
  assert.equal(side.branch, 'side');
  assert.deepEqual(side.actions[0], { type: 'rebound', direction: -1, force: false, durationPerLane: .5 });
  assert.equal(side.actions[1].horizontal, 'Left');
  assert.equal(side.actions[1].vertical, 'Middle');
  assert.equal(resolveClassicImpact(base({ x: -8, z: 20, trackMovement: 1, tutorial: true }))
    .actions[0].durationPerLane, SOURCE.tutorialReboundDurationPerLane);
  assert.deepEqual(resolveClassicImpact(base({ z: 20, trackMovement: 0 })).actions, []);
});

test('front HitBounceOnly corner emits two ordered stumbles, not a lane rebound', () => {
  const hit = resolveClassicImpact(base({ x: -8, trackMovement: 1, obstacleLayer: 'HitBounceOnly' }));
  assert.equal(hit.branch, 'corner');
  assert.deepEqual(types(hit), ['stumble', 'stumble']);
  assert.deepEqual(hit.actions.map(a => [a.horizontal, a.vertical]), [['Center', 'Lower'], ['LeftCorner', 'Middle']]);
  const state = new ClassicCollisionState();
  assert.equal(state.stumble(hit.actions[0]).deathRequested, false);
  assert.equal(state.stumble(hit.actions[1]).deathRequested, true);
  assert.equal(state.step(.21).fatal, true);
});

test('ordinary front corner forces rebound, while HitBounceOnly back corner also forces it', () => {
  const front = resolveClassicImpact(base({ x: -8, trackMovement: 1 }));
  assert.deepEqual(types(front), ['rebound', 'stumble']);
  assert.equal(front.actions[0].force, true);
  const back = resolveClassicImpact(base({ x: -8, z: 50, trackMovement: 1, obstacleLayer: 'HitBounceOnly' }));
  assert.deepEqual(types(back), ['rebound', 'stumble']);
  assert.equal(back.actions[0].force, true);
  assert.deepEqual(types(resolveClassicImpact(base({ x: -8, z: 50, trackMovement: 1 }))), ['stumble']);
});

test('front middle emits disableForward, critical stumble and critical notification in order', () => {
  const hit = resolveClassicImpact(base());
  assert.equal(hit.branch, 'front-middle');
  assert.deepEqual(types(hit), ['disableForward', 'stumble', 'criticalHit']);
  assert.equal(hit.actions[1].critical, true);
  assert.equal(hit.actions[1].vertical, 'Middle');
});

test('moving train front hit precedes corner stumble, but low front branch still hops', () => {
  const train = resolveClassicImpact(base({ obstacleTag: 'HitMovingTrain' }));
  assert.deepEqual(types(train), ['disableForward', 'hitByTrain', 'criticalHit']);
  const corner = resolveClassicImpact(base({ x: -8, trackMovement: 1, obstacleTag: 'HitMovingTrain' }));
  assert.deepEqual(types(corner), ['disableForward', 'hitByTrain', 'criticalHit', 'stumble']);
  assert.deepEqual(types(resolveClassicImpact(base({ high: 4, obstacleTag: 'HitMovingTrain' }))),
    ['setVerticalSpeed', 'stumble']);
});

test('upward entry below roof sets ceiling and zero speed without critical hit', () => {
  const input = base({ x: 1, z: 4, low: 8, jumping: true,
    lastFixedPosition: [1, 0, 4], previousFixedPosition: [1, -1, 4],
  });
  assert.equal(enteredColliderFromBelow(input).entered, true);
  const hit = resolveClassicImpact(input);
  assert.equal(hit.branch, 'ceiling-evasion');
  assert.deepEqual(types(hit), ['setVerticalSpeed']);
  assert.deepEqual(hit.ceiling, { hit: true, minY: 8, evaded: false });
  assert.equal(hit.actions[0].valueNative, 0);
  const front = resolveClassicImpact({ ...input, previousFixedPosition: [1, 0, 3] });
  assert.equal(front.branch, 'front-upper');
  assert.deepEqual(types(front), ['setVerticalSpeed', 'stumble', 'criticalHit']);
});

test('old ceiling height permits jumping under a higher roof but not nonjumping movement', () => {
  const input = base({ x: 1, z: 4, low: 8, jumping: true, ceiling: { hit: true, minY: 7, evaded: true },
    lastFixedPosition: [1, 0, 4], previousFixedPosition: [1, 0, 3],
  });
  const hit = resolveClassicImpact(input);
  assert.equal(hit.branch, 'ceiling-evasion');
  assert.equal(hit.ceiling.minY, 7);
  assert.equal(hit.ceiling.evaded, false);
  assert.equal(resolveClassicImpact({ ...input, jumping: false }).branch, 'front-upper');
  assert.equal(resolveClassicImpact({ ...input, ceiling: { hit: true, minY: 9 } }).branch, 'front-upper');
  const grounded = resolveClassicImpact({ ...input, ceiling: { hit: false }, grounded: true });
  assert.equal(grounded.ceiling.hit, false);
  assert.ok(!types(grounded).includes('setVerticalSpeed'));
});

test('upper collision zeros vertical speed before a harmless middle-X side branch', () => {
  const hit = resolveClassicImpact(base({ z: 20, low: 8, jumping: true }));
  assert.equal(hit.branch, 'side');
  assert.deepEqual(types(hit), ['setVerticalSpeed']);
  assert.equal(hit.ceiling.hit, true);
});

test('Stumble tag is Bush only on an actual Hit trigger; solid geometry decides its effect', () => {
  const trigger = resolveClassicImpact(base({ isTrigger: true, obstacleTag: 'Stumble' }));
  assert.equal(trigger.actions[0].stumbleType, 'Bush');
  assert.equal(trigger.actions[0].vertical, 'Lower');
  assert.equal(resolveClassicImpact(base({ obstacleTag: 'Stumble' })).branch, 'front-middle');
  assert.equal(resolveClassicImpact(base({ high: 4, obstacleTag: 'Stumble' })).branch, 'front-lower');
  assert.equal(resolveClassicImpact(base({ isTrigger: true })).actions[0].vertical, 'Middle');
  assert.deepEqual(resolveClassicImpact(base({ isTrigger: true, obstacleLayer: 'HitBounceOnly' })).actions, []);
  for (const obstacleLayer of ['Default', 'Unremovable']) {
    assert.deepEqual(resolveClassicImpact(base({ obstacleLayer })).actions, []);
  }
});

test('no behind-center fatal hit; special board local branches preserve action distinctions', () => {
  assert.deepEqual(resolveClassicImpact(base({ z: 50 })).actions, []);
  const tele = resolveClassicImpact(base({ high: 4, teleboard: true }));
  assert.deepEqual(types(tele), ['setVerticalSpeed', 'resetTeleportFX']);
  const glide = resolveClassicImpact(base({ high: 4, gliderboard: true }));
  assert.equal(glide.actions[0].valueNative, Math.fround(Math.sqrt(600)));
  assert.throws(() => classifyImpact({ ...base(), unitScale: 0 }));
  assert.throws(() => resolveClassicImpact(base({ trackMovement: 2 })));
});
