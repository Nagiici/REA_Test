import test from 'node:test';
import assert from 'node:assert/strict';
import { Hoverboard, HOVERBOARD_SOURCE as SOURCE, HOVERBOARD_BROWSER_ADAPTER } from '../src/hoverboard.js';

test('local inventory is consumed only on an allowed activation, never by denied or repeated taps', () => {
  const board = new Hoverboard(HOVERBOARD_BROWSER_ADAPTER);
  assert.equal(board.activate({ flying: true }), false);
  assert.equal(board.activate({ allowed: false }), false);
  assert.equal(board.state.inventory, 3);
  assert.equal(board.activate(), true);
  assert.equal(board.activate(), false);
  assert.equal(board.state.inventory, 2);
  board.step(30);
  assert.equal(board.activate(), true);
  board.step(30);
  assert.equal(board.activate(), true);
  board.step(30);
  assert.equal(board.activate(), false);
});

test('source duration is 30 seconds; Jetpack hides and pauses the existing board without consuming another', () => {
  const board = new Hoverboard();
  board.activate();
  board.step(12);
  board.step(60, { pausedForFlight: true });
  assert.equal(board.state.timeLeft, 18);
  assert.equal(board.visible, false);
  assert.equal(board.hit(), false);
  board.step(0, { pausedForFlight: false });
  assert.equal(board.visible, true);
  board.step(17.99);
  assert.equal(board.state.active, true);
  assert.deepEqual(board.step(.02), [{ type: 'expired' }]);
  assert.equal(board.state.inventory, 2);
  assert.equal(board.state.cooldownBlocked, true);
  assert.equal(board.activate(), false);
});

test('crash consumes protection, waits source particle delay, clears source-scaled distance and revives at height 15', () => {
  const board = new Hoverboard();
  board.activate();
  assert.equal(board.hit({ speedNormalized: 1.5 }), true);
  assert.equal(board.state.active, false);
  assert.equal(board.visible, false);
  assert.deepEqual(board.step(.1, { levelSpeed: 165 }), []);
  assert.equal(board.hit(), true); // Game.Die duplicate-call guard, no second crash.
  const result = board.step(SOURCE.crashParticleDelay - .1, { levelSpeed: 165 });
  assert.deepEqual(result, [{ type: 'clearObstacles', distanceNative: 375 }, { type: 'revive', jumpHeightNative: 15 }]);
  assert.equal(board.state.inventory, 2);
  assert.equal(board.state.cooldownRemainingNative, 174);
  assert.deepEqual(board.step(10, { levelSpeed: 165 }), []);
  assert.equal(board.state.cooldownBlocked, true);
  assert.equal(board.state.cooldownRemainingNative, 39); // Source loop stops after 90 * 1.5.
  assert.equal(board.hit(), false);
});

test('explicit browser repair uses travelled source distance rather than an assumed number of seconds', () => {
  const board = new Hoverboard(HOVERBOARD_BROWSER_ADAPTER);
  board.activate();
  board.hit({ speedNormalized: 2 });
  board.step(SOURCE.crashParticleDelay, { levelSpeed: 220 });
  board.step(1, { levelSpeed: 100 });
  assert.equal(board.state.cooldownRemainingNative, 132);
  assert.equal(board.activate(), false);
  board.step(10, { levelSpeed: 0 });
  assert.equal(board.state.cooldownRemainingNative, 132);
  assert.deepEqual(board.step(.6, { levelSpeed: 220 }), [{ type: 'rearmed', policy: 'distance-repair' }]);
  assert.equal(board.activate(), true);
});

test('ordinary expiry emits no crash clearing or revival; reset is the native latch-clearing boundary', () => {
  const board = new Hoverboard();
  board.activate();
  assert.deepEqual(board.step(30), [{ type: 'expired' }]);
  assert.deepEqual(board.step(100, { levelSpeed: 220 }), []);
  board.reset({ inventory: 1 });
  assert.equal(board.state.cooldownBlocked, false);
  assert.equal(board.activate(), true);
  assert.equal(board.state.inventory, 0);
});
