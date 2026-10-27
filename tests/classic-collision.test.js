import test from 'node:test';
import assert from 'node:assert/strict';
import { ClassicCollisionState, CLASSIC_COLLISION_SOURCE as SOURCE } from '../src/classic-collision.js';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test('a side stumble approaches, holds five seconds, then retreats with source smoothstep', () => {
  const state = new ClassicCollisionState();
  assert.equal(state.stumble().fatal, false);
  assert.equal(state.isStumbling, true);
  state.step(SOURCE.guardCatchUpSeconds / 2);
  near(state.guardDistanceNative, 20);
  state.step(SOURCE.guardCatchUpSeconds / 2);
  near(state.guardDistanceNative, 10);
  state.step(5 - SOURCE.guardCatchUpSeconds);
  assert.equal(state.isStumbling, false);
  assert.equal(state.guardClose, false);
  near(state.guardDistanceNative, 10);
  state.step(0.75);
  near(state.guardDistanceNative, 20);
  state.step(0.75);
  near(state.guardDistanceNative, 30);
});

test('second stumble reads the old flag and requests death after the source delay', () => {
  const state = new ClassicCollisionState();
  state.stumble();
  state.step(4.999);
  const hit = state.stumble();
  assert.equal(hit.deathRequested, true);
  assert.equal(hit.fatal, false);
  assert.equal(state.step(0.1).fatal, false);
  assert.equal(state.step(SOURCE.deathDelaySeconds - 0.1).fatal, true);
  assert.equal(state.step(1).fatal, false);
});

test('timer-first five-second boundary permits a new first stumble', () => {
  const state = new ClassicCollisionState();
  state.stumble();
  assert.equal(state.step(5).recovered, true);
  assert.equal(state.stumble().deathRequested, false);
});

test('safe stumble clears the next flag but does not bypass the old-flag notification', () => {
  const state = new ClassicCollisionState();
  assert.equal(state.stumble({ safe: true }).deathRequested, false);
  assert.equal(state.isStumbling, false);
  assert.equal(state.guardClose, true);
  assert.equal(state.stumble().deathRequested, false);
  assert.equal(state.stumble({ safe: true }).deathRequested, true);
  assert.equal(state.isStumbling, false);
  assert.equal(state.step(SOURCE.deathDelaySeconds).fatal, true);
});

test('pause freezes recovery, guard and pending death', () => {
  const state = new ClassicCollisionState();
  state.stumble();
  state.stumble();
  const before = state.snapshot();
  const paused = state.step(60, { paused: true });
  assert.deepEqual(state.snapshot(), before);
  assert.equal(paused.fatal, false);
  assert.equal(state.step(SOURCE.deathDelaySeconds).fatal, true);
});

test('death commit rechecks flight/running, while StopStumble alone does not cancel it', () => {
  for (const options of [{ flying: true }, { running: false }]) {
    const state = new ClassicCollisionState();
    state.stumble(); state.stumble(); state.stopStumble();
    assert.equal(state.step(SOURCE.deathDelaySeconds, options).fatal, false);
    assert.equal(state.hasPendingDeath, false);
  }
  const state = new ClassicCollisionState();
  state.stumble(); state.stumble(); state.stopStumble();
  assert.equal(state.step(SOURCE.deathDelaySeconds).fatal, true);
});

test('critical contact is an immediate death request for the caller to route through board protection', () => {
  const state = new ClassicCollisionState();
  assert.equal(state.stumble({ critical: true }).fatal, true);
  assert.equal(state.stumble({ critical: true, flying: true }).fatal, false);
});

test('large timesteps split at recovery, and a new catch-up starts at the current distance', () => {
  const state = new ClassicCollisionState();
  state.stumble();
  state.step(5.75);
  near(state.guardDistanceNative, 20);
  state.stumble();
  state.step(SOURCE.guardCatchUpSeconds / 2);
  near(state.guardDistanceNative, 15);
  state.reset();
  assert.equal(state.isStumbling, false);
  assert.equal(state.hasPendingDeath, false);
  near(state.guardDistanceNative, 30);
  assert.throws(() => state.step(-1));
});
