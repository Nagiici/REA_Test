import test from 'node:test';
import assert from 'node:assert/strict';
import { Jetpack, JETPACK_SECONDS } from '../src/jetpack.js';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test('tier zero plans the source empty landing section and stops its coins early', () => {
  const jetpack = new Jetpack();
  const flight = jetpack.begin({ distance: 0, y: 0, levelSpeed: 11, minimumTargetZ: 36 });
  assert.equal(flight.duration, 8);
  assert.equal(flight.speed, 22);
  assert.equal(flight.takeoffDistance, 33);
  assert.equal(flight.targetZ, 216);
  near(flight.initialTimeLeft, 211 / 22);
  assert.equal(flight.coinStartDistance, 53);
  near(flight.coinLength, 158);
  near(flight.coinEndDistance, 211);
  near(flight.laneChangeSeconds, 6 / 22);
  assert.equal(flight.detectCollisions, false);
  assert.equal(flight.characterColliderEnabled, false);
});

test('takeoff uses frame-start distance, smoothstep and the pickup height', () => {
  const jetpack = new Jetpack();
  jetpack.begin({ distance: 100, y: 2, levelSpeed: 11 });
  assert.equal(jetpack.step(0.5, { distance: 100 }).y, 2);
  near(jetpack.step(0.1, { distance: 108.25 }).y, 2 + 7.5 * 0.15625);
  near(jetpack.step(0.1, { distance: 116.5 }).y, 5.75);
  const cruise = jetpack.step(0.1, { distance: 133 });
  assert.equal(cruise.y, 9.5);
  assert.equal(cruise.takingOff, false);
  assert.equal(cruise.detectCollisions, false);
  assert.equal(cruise.characterColliderEnabled, true);
});

test('UI expiry does not terminate flight; target crossing emits one landing transition', () => {
  const jetpack = new Jetpack();
  const flight = jetpack.begin({ distance: 0, y: 0, levelSpeed: 11 });
  const atTimerExpiry = jetpack.step(flight.initialTimeLeft + 0.1, { distance: 212 });
  assert.equal(atTimerExpiry.timeLeft, 0);
  assert.equal(atTimerExpiry.active, true);
  assert.equal(atTimerExpiry.speed, 22);
  const landed = jetpack.step(1 / 60, { distance: 216.1 });
  assert.equal(landed.active, false);
  assert.equal(landed.ended, true);
  assert.equal(landed.y, 9.5);
  assert.equal(landed.speed, 11);
  assert.equal(landed.detectCollisions, true);
  assert.equal(jetpack.step(1 / 60, { distance: 216.2 }).ended, false);
});

test('planned minimum endpoint and upgrade tier affect the route plan', () => {
  assert.deepEqual(JETPACK_SECONDS, [8, 9, 10.5, 12.5, 15, 19, 25]);
  const jetpack = new Jetpack({ tier: 6 });
  const flight = jetpack.begin({ distance: 0, y: 0, levelSpeed: 11 });
  assert.equal(flight.targetZ, 576);
  assert.equal(flight.duration, 25);
  const extended = jetpack.begin({ distance: 0, y: 0, levelSpeed: 11, minimumTargetZ: 720 });
  assert.equal(extended.targetZ, 720);
  near(extended.initialTimeLeft, 715 / 22);
  near(extended.coinEndDistance, 715);
});

test('reset clears an active flight without preserving its timers', () => {
  const jetpack = new Jetpack();
  jetpack.begin({ distance: 100, y: 3, levelSpeed: 16 });
  jetpack.step(1, { distance: 120 });
  assert.equal(jetpack.reset().active, false);
  assert.equal(jetpack.timeLeft, 0);
  assert.equal(jetpack.targetZ, 0);
  const next = jetpack.begin({ distance: 0, y: 0, levelSpeed: 11 });
  assert.equal(next.elapsed, 0);
  assert.equal(next.y, 0);
  assert.equal(next.targetZ, 216);
});
