import test from 'node:test';
import assert from 'node:assert/strict';
import { CLASSIC_MOTION_SOURCE as SOURCE, jumpRole, landingRole, laneAnimationPlan,
  pickSourceAnimation, SourceRollTimeline, selectCatchSequence, SourceCatchTimeline } from '../src/classic-motion.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test('normal landing uses the source velocity boundaries and does not interrupt rolling', () => {
  for (const [velocity, role] of [[0, 'run'], [-20, 'run'], [-20.01, 'smallLand'],
    [-40, 'smallLand'], [-40.01, 'land'], [-150, 'land'], [-150.01, 'bigLand']]) {
    assert.equal(landingRole(velocity), role);
  }
  assert.equal(landingRole(-180, { rolling: true }), null);
});

test('no-land animation requires its explicit mode flag; jump zero uses the normal role', () => {
  assert.equal(jumpRole(), 'jump');
  assert.equal(jumpRole({ heightNative: 10 }), 'smallJump');
  assert.equal(jumpRole({ heightNative: 10.01 }), 'jump');
  assert.equal(jumpRole({ heightNative: 20, noLandStumbling: true }), 'stumbleNoLand');
});

test('lane animation respects airborne jumping and the moving-train death state', () => {
  const ground = laneAnimationPlan({ direction: 'left', grounded: true, jumping: false });
  assert.equal(ground.play, 'dodgeLeft');
  assert.equal(ground.queue, 'run');
  assert.equal(ground.queueFade, SOURCE.dodgeToRunFade);
  assert.equal(laneAnimationPlan({ direction: 'right', grounded: false, jumping: true }).play, null);
  assert.equal(laneAnimationPlan({ direction: 'right', grounded: false, jumping: true }).queue, null);
  assert.equal(laneAnimationPlan({ direction: 'right', flying: true }).play, 'dodgeRight');
  assert.deepEqual(laneAnimationPlan({ direction: 'right', grounded: true, hitMovingPlaying: true }), { play: null, queue: null });
});

test('animation pool sampling retains duplicated entries and consumes singleton RNG', () => {
  let draws = 0;
  assert.equal(pickSourceAnimation(['roll'], () => { draws++; return 0.8; }), 'roll');
  assert.equal(draws, 1);
  const sourceJump = ['jump', 'jump', 'jump_salto', 'jump2', 'jump3'];
  assert.deepEqual([.1, .3, .5, .7, .9].map(u => pickSourceAnimation(sourceJump, () => u)), sourceJump);
});

test('roll ends at raw clip length, permits interruption, and repeated starts never extend it', () => {
  const roll = new SourceRollTimeline();
  assert.equal(roll.begin(0.5416666865348816), true);
  roll.step(.3);
  assert.equal(roll.begin(2), false);
  assert.equal(roll.step(.24), false);
  assert.equal(roll.step(.002), true);
  assert.equal(roll.step(1), false);
  assert.equal(roll.begin(.5416666865348816), true);
  assert.equal(roll.step(.1, { enabled: false }), true);
  assert.equal(roll.begin(.5416666865348816), true);
  assert.equal(roll.step(.1, { rolling: false }), true);
});

test('catch side uses track-relative native X and draws both pools before selection', () => {
  const pools = { caughtLeft: ['left0', 'left1', 'left2'], caughtRight: ['right0', 'right1', 'right2'] };
  const values = [.9, .1]; let draws = 0;
  const selected = selectCatchSequence({ ...pools, characterXNative: 40, trackXNative: 40,
    random: () => values[draws++] });
  assert.equal(draws, 2);
  assert.equal(selected.sequence, 'left2');
  assert.equal(selectCatchSequence({ ...pools, characterXNative: 40, trackXNative: 20,
    debugIndex: 1, random: () => { throw new Error('valid debug index must not draw'); } }).sequence, 'right1');
});

test('catch animation advances invisibly before the source frame offset, then fades over .2 seconds', () => {
  for (const offset of [17, 24]) {
    const timeline = new SourceCatchTimeline({ catchAvatarAnimationPlayOffset: offset, waitTimeBeforeScreen: 4.9 });
    assert.equal(timeline.sample().avatarWeight, 0);
    const delayed = timeline.step(timeline.delay);
    near(delayed.avatarTime, Math.fround(offset / 25));
    assert.equal(delayed.avatarWeight, 0);
    near(timeline.step(SOURCE.catchFade / 2).avatarWeight, .5);
    near(timeline.step(SOURCE.catchFade / 2).avatarWeight, 1);
    assert.equal(timeline.sample().guardApproachProgress, 1);
  }
});

test('pausing freezes both source timelines without consuming a pending roll completion', () => {
  const roll = new SourceRollTimeline(); roll.begin(.54); roll.step(.3);
  assert.equal(roll.step(100, { paused: true, enabled: false }), false);
  assert.equal(roll.elapsed, .3);
  assert.equal(roll.step(.25), true);
  const caught = new SourceCatchTimeline({ catchAvatarAnimationPlayOffset: 17 });
  caught.step(.2); const before = caught.sample();
  assert.deepEqual(caught.step(100, { paused: true }), before);
});
